'use server'

import { createClient } from '@/lib/supabase/server'
import { moverEnR2, deleteFromR2, buildR2Key, getR2ObjectSize } from '@/lib/r2/client'
import {
  esUuidValido,
  keyDeStagingPropia,
  normalizarTipoMime,
  sanitizarNombreArchivo,
} from '@/lib/archivos-seguros'
import type { FicheroEnLote, Json } from '@/types/database'
import { revalidatePath } from 'next/cache'

const LOTE_TTL_MS = 24 * 60 * 60 * 1000 // los lotes staging caducan en 24 h
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, igual que la subida normal
const MAX_FICHEROS_LOTE = 10

function parsearFicheros(metadatos: Json): FicheroEnLote[] {
  if (!Array.isArray(metadatos)) return []
  return metadatos.filter(
    (m): m is FicheroEnLote =>
      typeof m === 'object' && m !== null &&
      typeof (m as FicheroEnLote).clave === 'string' &&
      typeof (m as FicheroEnLote).nombre === 'string'
  )
}

// ---------------------------------------------------------------------------
// Limpieza de lotes caducados (>24 h): borra sus objetos de staging en R2 y
// las filas. Se ejecuta de forma oportunista al abrir /recibir; también lista
// para llamarse desde un cron (p. ej. Vercel Cron) cuando lo haya.
// ---------------------------------------------------------------------------
export async function limpiarLotesCaducados() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { limpiados: 0 }

  const limite = new Date(Date.now() - LOTE_TTL_MS).toISOString()

  const { data: lotes, error } = await supabase
    .from('lotes_recibidos')
    .select('id, usuario_id, claves_r2, metadatos')
    .lt('fecha_creacion', limite)
  if (error || !lotes || lotes.length === 0) return { limpiados: 0 }

  const ids: string[] = []
  for (const lote of lotes) {
    // Solo se borran objetos de staging del dueño de la fila. Así una fila
    // manipulada con una key ajena no puede borrar archivos de otra persona.
    for (const c of Array.isArray(lote.claves_r2) ? lote.claves_r2 : []) {
      if (typeof c === 'string' && keyDeStagingPropia(c, lote.usuario_id)) {
        await deleteFromR2(c).catch(() => {})
      }
    }
    for (const f of parsearFicheros(lote.metadatos)) {
      if (keyDeStagingPropia(f.clave, lote.usuario_id)) {
        await deleteFromR2(f.clave).catch(() => {})
      }
    }
    ids.push(lote.id)
  }
  if (ids.length > 0) {
    await supabase.from('lotes_recibidos').delete().in('id', ids)
  }

  return { limpiados: ids.length }
}

// ---------------------------------------------------------------------------
// Confirmar guardado: mueve cada fichero del staging a su destino definitivo
// (staging → key por scope vía Copy+Delete) y lo registra en `archivos`.
// El trigger trg_registrar_subida audita cada SUBIR_ARCHIVO automáticamente.
// ---------------------------------------------------------------------------
export async function confirmarGuardado(params: {
  loteId: string
  scope: 'comun' | 'privado'
  carpetaDestinoId: string | null
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: lote, error: loteError } = await supabase
    .from('lotes_recibidos')
    .select('*')
    .eq('id', params.loteId)
    .eq('usuario_id', user.id)
    .single()

  if (loteError || !lote) return { error: 'Lote no válido o ya guardado.' }

  if (Date.now() - new Date(lote.fecha_creacion).getTime() > LOTE_TTL_MS) {
    const ficheros = parsearFicheros(lote.metadatos)
    await Promise.all(
      ficheros
        .filter((f) => keyDeStagingPropia(f.clave, user.id))
        .map((f) => deleteFromR2(f.clave).catch(() => {}))
    )
    await supabase.from('lotes_recibidos').delete().eq('id', lote.id)
    return { error: 'El lote caducó (más de 24 h). Comparte de nuevo los archivos.' }
  }

  // Validar destino: la carpeta debe existir, ser visible (RLS) y concordar
  // el scope con su privacidad. Con carpeta null se guarda en la raíz del scope.
  if (params.carpetaDestinoId) {
    if (!esUuidValido(params.carpetaDestinoId)) {
      return { error: 'Carpeta de destino no válida.' }
    }
    const { data: carpeta, error: carpetaError } = await supabase
      .from('carpetas')
      .select('id, es_privada, creado_por')
      .eq('id', params.carpetaDestinoId)
      .single()
    if (carpetaError || !carpeta) return { error: 'Carpeta de destino no válida.' }
    if ((params.scope === 'privado') !== carpeta.es_privada) {
      return { error: 'El destino no concuerda con el ámbito elegido.' }
    }
    // La Caja fuerte es privada también para el admin: no se guarda en la de otro.
    if (carpeta.es_privada && carpeta.creado_por !== user.id) {
      return { error: 'No puedes guardar en una carpeta privada que no es tuya.' }
    }
  }

  const todos = parsearFicheros(lote.metadatos)
  if (todos.length === 0) {
    await supabase.from('lotes_recibidos').delete().eq('id', lote.id)
    return { error: 'El lote está vacío.' }
  }

  const ficheros = todos.slice(0, MAX_FICHEROS_LOTE)
  let guardados = 0
  const pendientes: string[] = []
  let cupoLleno = false

  // Un lote manipulado no puede traer más de 10 ficheros ni claves ajenas:
  // solo se limpia el staging propio que no se va a guardar.
  for (const sobrante of todos.slice(MAX_FICHEROS_LOTE)) {
    if (keyDeStagingPropia(sobrante.clave, user.id)) pendientes.push(sobrante.clave)
  }

  for (const fichero of ficheros) {
    // La clave debe estar bajo compartidos-pendientes/<uid>/: nunca se mueve
    // ni se borra un objeto de otra persona aunque la fila lo indique.
    if (!keyDeStagingPropia(fichero.clave, user.id)) continue

    const tamano = await getR2ObjectSize(fichero.clave)
    if (tamano === null) {
      // No se pudo verificar (objeto ausente o R2 caído). No se borra: si era
      // un fallo temporal, el fichero sigue en staging y no se pierde.
      continue
    }
    if (tamano > MAX_FILE_SIZE) {
      await deleteFromR2(fichero.clave).catch(() => {})
      continue
    }

    const nombre = sanitizarNombreArchivo(fichero.nombre)
    const tipo = normalizarTipoMime(fichero.tipo)
    const destinoKey = buildR2Key({ userId: user.id, fileName: nombre, scope: params.scope })
    try {
      await moverEnR2(fichero.clave, destinoKey)
    } catch {
      pendientes.push(fichero.clave) // staging intacto; se limpia abajo
      continue
    }

    const { error: insertError } = await supabase.from('archivos').insert({
      nombre_original: nombre,
      ruta_r2: destinoKey,
      tamano_bytes: tamano,
      tipo_mime: tipo,
      carpeta_id: params.carpetaDestinoId,
      subido_por: user.id,
      estado: 'activo',
    })

    if (insertError) {
      // Evita objeto huérfano en R2 sin fila en BD
      await deleteFromR2(destinoKey).catch(() => {})
      pendientes.push(fichero.clave)
      if (insertError.message.includes('LIMITE_ALMACENAMIENTO')) {
        cupoLleno = true
        // Marca el resto como pendiente sin intentarlo
        const idx = ficheros.indexOf(fichero)
        for (const resto of ficheros.slice(idx + 1)) pendientes.push(resto.clave)
        break
      }
      continue
    }
    guardados += 1
  }

  // Limpia staging restante (fallidos o no intentados) y cierra el lote
  await Promise.all(pendientes.map((c) => deleteFromR2(c).catch(() => {})))
  await supabase.from('lotes_recibidos').delete().eq('id', lote.id)

  revalidatePath('/')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/familia')
  // Sin revalidatePath('/recibir'): el lote ya no existe tras confirmar y
  // revalidar aquí haría que la página mostrase "Lote no válido" tapando el éxito.

  if (guardados === 0) {
    return { error: cupoLleno ? 'El almacenamiento familiar ha alcanzado el límite de 9 GB.' : 'No se pudo guardar ningún archivo.' }
  }
  return { success: true, guardados, total: ficheros.length }
}
