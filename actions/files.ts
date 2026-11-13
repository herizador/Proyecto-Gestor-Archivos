'use server'

import { createClient } from '@/lib/supabase/server'
import {
  getPresignedUploadUrl,
  getPresignedViewUrl,
  getPresignedDownloadUrl,
  deleteFromR2,
  buildR2Key,
  getR2ObjectSize,
} from '@/lib/r2/client'
import {
  esUuidValido,
  keyPerteneceAUsuario,
  keyValidaParaFila,
  normalizarTipoMime,
  sanitizarNombreArchivo,
} from '@/lib/archivos-seguros'
import { logActivity } from '@/actions/storage'
import type { ArchivoConAutor } from '@/types/database'
import { revalidatePath } from 'next/cache'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

type Scope = 'comun' | 'publico' | 'privado'

// Infiere el scope desde el prefijo físico de la key R2. No basta por sí solo:
// la pertenencia real se comprueba con keyPerteneceAUsuario().
function scopeDeKey(rutaR2: string): Scope | null {
  if (rutaR2.startsWith('comun/')) return 'comun'
  if (rutaR2.includes('/privado/')) return 'privado'
  if (rutaR2.includes('/publico/')) return 'publico'
  return null
}

// Valida que la carpeta exista, sea visible (RLS) y que su privacidad concuerde
// con el scope. Devuelve el scope efectivo: el de la carpeta manda sobre el
// que envía el cliente (nunca fiarse del cliente).
async function validarCarpetaDestino(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  carpetaId: string | null,
  scope: Scope
): Promise<{ error?: string; scope: Scope }> {
  if (!carpetaId) return { scope }
  if (!esUuidValido(carpetaId)) return { error: 'Carpeta de destino no válida.', scope }
  const { data: carpeta, error } = await supabase
    .from('carpetas')
    .select('id, es_privada, creado_por')
    .eq('id', carpetaId)
    .single()
  if (error || !carpeta) return { error: `Carpeta de destino no válida (${error?.code ?? 'sin código'}: ${error?.message ?? 'sin detalle'}).`, scope }
  // La Caja fuerte es privada también para el admin: no se sube a la de otro.
  if (carpeta.es_privada && carpeta.creado_por !== userId) {
    return { error: 'No puedes subir a una carpeta privada que no es tuya.', scope }
  }
  const esperado: Scope = carpeta.es_privada ? 'privado' : 'comun'
  if (scope !== esperado) return { error: 'El destino no concuerda con el ámbito elegido.', scope }
  return { scope: esperado }
}

// ---------------------------------------------------------------------------
// Obtener URL pre-firmada de subida (el cliente sube directo a R2)
// ---------------------------------------------------------------------------
export async function getUploadUrl(params: {
  fileName: string
  contentType: string
  fileSize: number
  carpetaId: string | null
  scope: 'comun' | 'publico' | 'privado'
}) {
  const tamano = Number(params.fileSize)
  if (!Number.isFinite(tamano) || tamano < 0) {
    return { error: 'Tamaño de archivo no válido.' }
  }
  if (tamano > MAX_FILE_SIZE) {
    return { error: 'El archivo supera el límite de 20 MB permitido.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const validacion = await validarCarpetaDestino(supabase, user.id, params.carpetaId, params.scope)
  if (validacion.error) return { error: validacion.error }

  // El nombre y el tipo que se firman son los saneados, no los crudos del
  // cliente: si luego cambia el header Content-Type, la firma no valida.
  const nombre = sanitizarNombreArchivo(params.fileName)
  const tipoMime = normalizarTipoMime(params.contentType)
  const key = buildR2Key({ userId: user.id, fileName: nombre, scope: validacion.scope })

  try {
    const uploadUrl = await getPresignedUploadUrl(key, tipoMime, tamano)
    return { uploadUrl, key, contentType: tipoMime }
  } catch {
    return { error: 'Error al generar la URL de subida.' }
  }
}

// ---------------------------------------------------------------------------
// Registrar archivo en BD tras subida exitosa a R2
// ---------------------------------------------------------------------------
export async function registrarArchivo(params: {
  nombreOriginal: string
  rutaR2: string
  tamanoBytes: number
  tipoMime: string
  carpetaId: string | null
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const key = typeof params.rutaR2 === 'string' ? params.rutaR2 : ''

  // La key debe pertenecer al usuario (o al Área común) y declarar un scope
  // válido. Sin esto, una fila podría apuntar a los bytes privados de otro.
  if (!keyPerteneceAUsuario(key, user.id)) {
    return { error: 'Ruta de almacenamiento no válida.' }
  }
  const scopeKey = scopeDeKey(key)
  if (!scopeKey) return { error: 'Ruta de almacenamiento no válida.' }

  // Una misma key solo se registra una vez: evita duplicar filas, reclamar un
  // objeto ajeno del Área común y que un borrado posterior elimine bytes vivos.
  const { count } = await supabase
    .from('archivos')
    .select('id', { count: 'exact', head: true })
    .eq('ruta_r2', key)
  if ((count ?? 0) > 0) return { error: 'Ese archivo ya está registrado.' }

  const validacion = await validarCarpetaDestino(supabase, user.id, params.carpetaId, scopeKey)
  if (validacion.error) return { error: validacion.error }

  // El tamaño que manda es el real de R2, no el declarado por el cliente.
  // Así una subida mayor de 20 MB no puede registrarse como pequeña ni saltarse
  // el cupo de 9 GB.
  const tamanoReal = await getR2ObjectSize(key)
  if (tamanoReal === null) {
    return { error: 'No se encontró el archivo en el almacenamiento. Vuelve a subirlo.' }
  }
  if (tamanoReal > MAX_FILE_SIZE) {
    await deleteFromR2(key).catch(() => {})
    return { error: 'El archivo supera el límite real de 20 MB y se ha descartado.' }
  }

  const nombre = sanitizarNombreArchivo(params.nombreOriginal)
  const tipo = normalizarTipoMime(params.tipoMime)

  const { error } = await supabase.from('archivos').insert({
    nombre_original: nombre,
    ruta_r2: key,
    tamano_bytes: tamanoReal,
    tipo_mime: tipo,
    carpeta_id: params.carpetaId,
    subido_por: user.id,
    estado: 'activo',
  })

  if (error) {
    console.error('[registrarArchivo] insert falló:', error.code, error.message)
    // El trigger de 9 GB devuelve un mensaje específico
    if (error.message.includes('LIMITE_ALMACENAMIENTO')) {
      await deleteFromR2(key).catch(() => {})
      return { error: 'El almacenamiento familiar ha alcanzado el límite de 9 GB. Contacta al administrador.' }
    }
    return { error: `No se pudo registrar el archivo (${error.code ?? 'sin código'}: ${error.message}).` }
  }

  revalidatePath('/')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Resuelve un id visible a su fichero físico: acepta tanto el id de `archivos`
// como el de un acceso directo (`accesos_directos`), que apunta al original.
// Huérfano (objetivo NULL) u original en papelera → error, nunca se firma nada.
// ---------------------------------------------------------------------------
async function resolverObjetivo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  idVisible: string
): Promise<
  | { error: string }
  | { ruta_r2: string; tipo_mime: string; nombre_original: string; originalId: string; accesoId: string | null }
> {
  if (!esUuidValido(idVisible)) return { error: 'Archivo no encontrado o sin permisos.' }

  const { data: acceso } = await supabase
    .from('accesos_directos')
    .select(`
      id,
      archivo_objetivo:archivos!accesos_directos_archivo_objetivo_id_fkey(
        id, ruta_r2, nombre_original, tipo_mime, estado, subido_por
      )
    `)
    .eq('id', idVisible)
    .single()

  const objetivo = Array.isArray(acceso?.archivo_objetivo)
    ? acceso.archivo_objetivo[0]
    : acceso?.archivo_objetivo

  if (acceso) {
    if (!objetivo || objetivo.estado !== 'activo') {
      return { error: 'El archivo original no está disponible (en papelera o eliminado).' }
    }
    // Última barrera: ni una fila manipulada puede firmar bytes privados ajenos.
    if (!keyValidaParaFila(objetivo.ruta_r2, objetivo.subido_por)) {
      return { error: 'El archivo original no está disponible.' }
    }
    return {
      ruta_r2: objetivo.ruta_r2,
      tipo_mime: objetivo.tipo_mime,
      nombre_original: objetivo.nombre_original,
      originalId: objetivo.id,
      accesoId: acceso.id,
    }
  }

  const { data: archivo, error } = await supabase
    .from('archivos')
    .select('id, ruta_r2, nombre_original, tipo_mime, subido_por')
    .eq('id', idVisible)
    .eq('estado', 'activo')
    .single()

  if (error || !archivo) return { error: 'Archivo no encontrado o sin permisos.' }
  if (!keyValidaParaFila(archivo.ruta_r2, archivo.subido_por)) {
    return { error: 'Archivo no encontrado o sin permisos.' }
  }
  return {
    ruta_r2: archivo.ruta_r2,
    tipo_mime: archivo.tipo_mime,
    nombre_original: archivo.nombre_original,
    originalId: archivo.id,
    accesoId: null,
  }
}

// ---------------------------------------------------------------------------
// Obtener URL pre-firmada para visualizar + auditar
// ---------------------------------------------------------------------------
export async function visualizarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const resuelto = await resolverObjetivo(supabase, archivoId)
  if ('error' in resuelto) return { error: resuelto.error }

  try {
    const url = await getPresignedViewUrl(resuelto.ruta_r2, resuelto.tipo_mime)

    await logActivity({
      accion: 'VISUALIZAR_ARCHIVO',
      detalles: {
        archivo_id: resuelto.originalId,
        nombre_original: resuelto.nombre_original,
        ...(resuelto.accesoId ? { acceso_id: resuelto.accesoId } : {}),
      },
    })

    return { url }
  } catch {
    return { error: 'Error al generar enlace de visualización.' }
  }
}

// ---------------------------------------------------------------------------
// Obtener URL pre-firmada de descarga + auditar (resuelve accesos directos)
// ---------------------------------------------------------------------------
export async function descargarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const resuelto = await resolverObjetivo(supabase, archivoId)
  if ('error' in resuelto) return { error: resuelto.error }

  try {
    const url = await getPresignedDownloadUrl(resuelto.ruta_r2, resuelto.nombre_original)

    await logActivity({
      accion: 'DESCARGAR_ARCHIVO',
      detalles: {
        archivo_id: resuelto.originalId,
        nombre_original: resuelto.nombre_original,
        ...(resuelto.accesoId ? { acceso_id: resuelto.accesoId } : {}),
      },
    })

    return { url, nombreOriginal: resuelto.nombre_original }
  } catch {
    return { error: 'Error al generar enlace de descarga.' }
  }
}

// ---------------------------------------------------------------------------
// Obtener URL para ENVIAR a otra app (Web Share / copiar) + auditar.
// A diferencia de descargar, registra COMPARTIR_EXTERNO para distinguir en el
// historial "lo mandé fuera" de "lo bajé a este dispositivo". Resuelve accesos.
// ---------------------------------------------------------------------------
export async function enviarArchivo(archivoId: string, auditar = true) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const resuelto = await resolverObjetivo(supabase, archivoId)
  if ('error' in resuelto) return { error: resuelto.error }

  try {
    const url = await getPresignedDownloadUrl(resuelto.ruta_r2, resuelto.nombre_original)

    // auditar=false en el flujo en dos pasos: se registra al compartir de
    // verdad, no al preparar (si el usuario cancela no debe quedar rastro).
    if (auditar) {
      await logActivity({
        accion: 'COMPARTIR_EXTERNO',
        detalles: {
          archivo_id: resuelto.originalId,
          nombre_original: resuelto.nombre_original,
          ...(resuelto.accesoId ? { acceso_id: resuelto.accesoId } : {}),
        },
      })
    }

    return { url, nombreOriginal: resuelto.nombre_original, tipoMime: resuelto.tipo_mime }
  } catch {
    return { error: 'Error al preparar el archivo para enviar.' }
  }
}

// ---------------------------------------------------------------------------
// Auditoría diferida del envío externo: se llama solo cuando el menú del
// sistema confirma que el envío se completó (no en cancelaciones).
// ---------------------------------------------------------------------------
export async function registrarEnvioExterno(archivoIds: string[]) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  for (const id of archivoIds) {
    const resuelto = await resolverObjetivo(supabase, id)
    if ('error' in resuelto) continue
    await logActivity({
      accion: 'COMPARTIR_EXTERNO',
      detalles: {
        archivo_id: resuelto.originalId,
        nombre_original: resuelto.nombre_original,
        ...(resuelto.accesoId ? { acceso_id: resuelto.accesoId } : {}),
      },
    })
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Renombrar archivo (solo cambia el nombre visible; la key R2 no se toca)
// ---------------------------------------------------------------------------
export async function renombrarArchivo(archivoId: string, nombre: string) {
  if (!String(nombre ?? '').trim()) return { error: 'El nombre no puede estar vacío.' }
  const limpio = sanitizarNombreArchivo(nombre, 200)
  if (!limpio) return { error: 'El nombre no es válido.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: archivo } = await supabase
    .from('archivos')
    .select('id, nombre_original, subido_por, estado')
    .eq('id', archivoId)
    .single()
  if (!archivo) return { error: 'Archivo no encontrado o sin permisos.' }
  if (archivo.estado !== 'activo') return { error: 'Solo se puede renombrar archivos activos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  if (archivo.subido_por !== user.id && perfil?.rol !== 'admin') {
    return { error: 'Sin permiso para renombrar este archivo.' }
  }
  if (archivo.nombre_original === limpio) return { success: true }

  const { data: actualizados, error } = await supabase
    .from('archivos')
    .update({ nombre_original: limpio })
    .eq('id', archivoId)
    .select('id')
  if (error || !actualizados || actualizados.length === 0) {
    return { error: 'No se pudo renombrar el archivo.' }
  }

  await logActivity({
    accion: 'RENOMBRAR_ARCHIVO',
    detalles: { archivo_id: archivoId, anterior: archivo.nombre_original, nuevo: limpio },
  })

  revalidatePath('/')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/familia')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Búsqueda global de archivos activos por nombre
// ---------------------------------------------------------------------------
export async function buscarArchivos(termino: string) {
  const trimmed = termino.trim()
  if (!trimmed) return { data: [] as ArchivoConAutor[] }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as ArchivoConAutor[] }

  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

  const { data, error } = await supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('estado', 'activo')
    .ilike('nombre_original', `%${escaped}%`)
    .order('fecha_subida', { ascending: false })
    .limit(50)

  if (error) return { error: error.message, data: [] as ArchivoConAutor[] }
  return { data: (data ?? []) as ArchivoConAutor[] }
}

// ---------------------------------------------------------------------------
// Mover archivo a la papelera (borrado lógico)
// ---------------------------------------------------------------------------
export async function moverAPapelera(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: actualizados, error } = await supabase
    .from('archivos')
    .update({ estado: 'papelera', fecha_papelera: new Date().toISOString() })
    .eq('id', archivoId)
    .select('id')

  if (error) return { error: 'No se pudo mover el archivo a la papelera.' }
  if (!actualizados || actualizados.length === 0) {
    return { error: 'Archivo no encontrado o sin permisos.' }
  }
  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Mover varios archivos a la papelera (modo selección, entre carpetas).
// La auditoría MOVER_A_PAPELERA la pone el trigger trg_cambio_estado_archivo.
// ---------------------------------------------------------------------------
export async function moverAPapeleraBatch(archivoIds: string[]) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const unicos = [...new Set(archivoIds)].slice(0, 50)
  if (unicos.length === 0) return { error: 'Selecciona al menos un archivo.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  let movidos = 0
  const fallidos: Array<{ id: string; nombre: string; error: string }> = []

  for (const id of unicos) {
    const { data: archivo } = await supabase
      .from('archivos')
      .select('id, nombre_original, subido_por, estado')
      .eq('id', id)
      .single()
    if (!archivo) {
      fallidos.push({ id, nombre: id.slice(0, 8), error: 'No encontrado o sin permisos.' })
      continue
    }
    if (archivo.subido_por !== user.id && !isAdmin) {
      fallidos.push({ id, nombre: archivo.nombre_original, error: 'Sin permiso.' })
      continue
    }
    if (archivo.estado === 'papelera') continue
    const { data: actualizados, error } = await supabase
      .from('archivos')
      .update({ estado: 'papelera', fecha_papelera: new Date().toISOString() })
      .eq('id', id)
      .select('id')
    if (error || !actualizados || actualizados.length === 0) {
      fallidos.push({ id, nombre: archivo.nombre_original, error: 'No se pudo mover a la papelera.' })
      continue
    }
    movidos += 1
  }

  revalidatePath('/')
  revalidatePath('/todos')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/recientes')
  revalidatePath('/favoritos')
  return { success: true, movidos, fallidos, total: unicos.length }
}

// ---------------------------------------------------------------------------
// Restaurar archivo de la papelera
// ---------------------------------------------------------------------------
export async function restaurarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: actualizados, error } = await supabase
    .from('archivos')
    .update({ estado: 'activo', fecha_papelera: null })
    .eq('id', archivoId)
    .select('id')

  if (error) return { error: 'No se pudo restaurar el archivo.' }
  if (!actualizados || actualizados.length === 0) {
    return { error: 'Archivo no encontrado o sin permisos.' }
  }
  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Eliminar archivo permanentemente (dueño o admin)
// ---------------------------------------------------------------------------
export async function eliminarArchivoPermanente(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { data: archivo, error: fetchError } = await supabase
    .from('archivos')
    .select('ruta_r2, nombre_original, subido_por')
    .eq('id', archivoId)
    .eq('estado', 'papelera')
    .single()

  if (fetchError || !archivo) return { error: 'Archivo no encontrado en la papelera.' }
  if (!isAdmin && archivo.subido_por !== user.id) {
    return { error: 'Solo el dueño o un administrador puede eliminar permanentemente.' }
  }

  // Contar enlaces que quedarán huérfanos (SET NULL) para la auditoría
  const { count: enlacesAfectados } = await supabase
    .from('accesos_directos')
    .select('id', { count: 'exact', head: true })
    .eq('archivo_objetivo_id', archivoId)

  // 1. Borrar de R2 (solo si la key pertenece al dueño de la fila; una fila
  // manipulada no debe poder borrar los bytes privados de otra persona)
  if (keyValidaParaFila(archivo.ruta_r2, archivo.subido_por)) {
    try {
      await deleteFromR2(archivo.ruta_r2)
    } catch {
      return { error: 'No se pudo borrar el archivo del almacenamiento. Inténtalo de nuevo.' }
    }
  }

  // 2. Borrar de BD
  const { error } = await supabase.from('archivos').delete().eq('id', archivoId)
  if (error) return { error: 'No se pudo eliminar el archivo. Inténtalo de nuevo.' }

  await logActivity({
    accion: 'ELIMINAR_PERMANENTE',
    detalles: {
      archivo_id: archivoId,
      nombre_original: archivo.nombre_original,
      enlaces_huerfanos: enlacesAfectados ?? 0,
    },
  })

  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Eliminar varios archivos de la papelera definitivamente (dueño o admin).
// Mismo orden que el borrado individual: primero R2 y luego BD. Los objetos se
// borran en tandas de 10 para no saturar R2 con un lote grande. La auditoría
// se guarda como una sola entrada con el recuento y los ids.
// ---------------------------------------------------------------------------
export async function eliminarArchivosPermanentes(archivoIds: string[]) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const unicos = [...new Set(archivoIds)]
  if (unicos.length === 0) return { error: 'Selecciona al menos un archivo.' }
  if (unicos.length > 100) {
    return { error: 'Máximo 100 archivos por lote. Elimínalos en varios lotes.' }
  }

  // Solo se tocan filas que sigan en la papelera: nunca un archivo activo.
  // Un miembro solo puede vaciar lo suyo; el admin, lo que RLS le deje ver.
  let consulta = supabase
    .from('archivos')
    .select('id, ruta_r2, nombre_original, subido_por')
    .in('id', unicos)
    .eq('estado', 'papelera')
  if (!isAdmin) consulta = consulta.eq('subido_por', user.id)
  const { data: archivos, error: fetchError } = await consulta
  if (fetchError) return { error: 'No se pudo leer la papelera. Inténtalo de nuevo.' }

  const filas = archivos ?? []
  if (filas.length === 0) return { error: 'No hay archivos en la papelera con esos ids.' }
  if (filas.length !== unicos.length) {
    return { error: 'Alguno de los archivos ya no está en tu papelera. Actualiza la página.' }
  }

  const borrados: typeof filas = []
  const fallidos: Array<{ id: string; nombre: string; error: string }> = []
  for (let i = 0; i < filas.length; i += 10) {
    const tanda = filas.slice(i, i + 10)
    // Las filas con una key que no pertenece a su dueño se borran de BD pero no
    // tocan R2: nunca se eliminan bytes de otra persona.
    const resultados = await Promise.allSettled(
      tanda.map((a) =>
        keyValidaParaFila(a.ruta_r2, a.subido_por)
          ? deleteFromR2(a.ruta_r2)
          : Promise.resolve()
      )
    )
    resultados.forEach((resultado, j) => {
      if (resultado.status === 'fulfilled') borrados.push(tanda[j])
      else fallidos.push({ id: tanda[j].id, nombre: tanda[j].nombre_original, error: 'No se pudo borrar de R2.' })
    })
  }

  let eliminados = 0
  if (borrados.length > 0) {
    const { error } = await supabase.from('archivos').delete().in('id', borrados.map((a) => a.id))
    if (error) {
      for (const a of borrados) fallidos.push({ id: a.id, nombre: a.nombre_original, error: 'No se pudo borrar de la base de datos.' })
    } else {
      eliminados = borrados.length
      await logActivity({
        accion: 'ELIMINAR_PERMANENTE',
        detalles: {
          cantidad: eliminados,
          archivo_ids: borrados.map((a) => a.id),
          nombre_original: `${eliminados} archivo${eliminados === 1 ? '' : 's'}`,
          lote: true,
        },
      })
    }
  }

  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/todos')
  revalidatePath('/recientes')
  revalidatePath('/favoritos')
  return { success: true, eliminados, fallidos, total: unicos.length }
}

// ---------------------------------------------------------------------------
// Obtener uso total de almacenamiento
// ---------------------------------------------------------------------------
export async function getStorageUsage(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_storage_usage')
  if (error) return 0
  return data as number
}
