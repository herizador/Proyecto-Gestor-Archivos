'use server'

import { createClient } from '@/lib/supabase/server'
import { buildR2Key, moverEnR2 } from '@/lib/r2/client'
import { logActivity } from '@/actions/storage'
import type { ObjetivoEnlace } from '@/actions/accesos'
import { revalidatePath } from 'next/cache'

type Scope = 'comun' | 'privado'
type Supa = Awaited<ReturnType<typeof createClient>>

// El ámbito físico va codificado en la key R2 (igual que en actions/files.ts)
function scopeDeKey(rutaR2: string): Scope | 'publico' | null {
  if (rutaR2.startsWith('comun/')) return 'comun'
  if (rutaR2.includes('/privado/')) return 'privado'
  if (rutaR2.includes('/publico/')) return 'publico'
  return null
}

// ---------------------------------------------------------------------------
// Mover en lote (modo selección): N archivos/carpetas al mismo destino.
// - Archivos: si el ámbito de su key no concuerda con el destino, los bytes se
//   reubican en R2 (Copy+Delete) y se actualiza ruta_r2; si no, solo carpeta_id.
// - Carpetas: solo dentro del mismo ámbito (sus ficheros llevan keys ligadas al
//   ámbito) y nunca dentro de sí mismas o sus hijas.
// Devuelve resumen: los fallos no abortan el resto.
// ---------------------------------------------------------------------------
export async function moverElementosBatch(params: {
  objetivos: ObjetivoEnlace[]
  destinoCarpetaId: string | null
  scope: Scope
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  if (params.objetivos.length === 0) return { error: 'Selecciona al menos un elemento para mover.' }
  if (params.objetivos.length > 50) return { error: 'Demasiados elementos a la vez (máximo 50).' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  // Destino: debe existir, ser visible (RLS) y concordar con el ámbito elegido
  let destinoEsPrivada: boolean | null = null
  if (params.destinoCarpetaId) {
    const { data: destino, error: destError } = await supabase
      .from('carpetas')
      .select('id, es_privada')
      .eq('id', params.destinoCarpetaId)
      .single()
    if (destError || !destino) return { error: 'Carpeta de destino no válida.' }
    destinoEsPrivada = destino.es_privada
    if ((params.scope === 'privado') !== destino.es_privada) {
      return { error: 'El destino no concuerda con el ámbito elegido.' }
    }
  }

  let movidos = 0
  let omitidos = 0
  const fallidos: Array<{ id: string; nombre: string; error: string }> = []

  for (const obj of params.objetivos) {
    if (obj.tipo === 'archivo') {
      const r = await moverArchivo(supabase, user.id, isAdmin, obj.id, obj.nombre, params.destinoCarpetaId, params.scope)
      if (r === 'ok') movidos += 1
      else if (r === 'omitido') omitidos += 1
      else fallidos.push({ id: obj.id, nombre: obj.nombre, error: r })
    } else {
      const r = await moverCarpeta(supabase, user.id, isAdmin, obj.id, params.destinoCarpetaId, params.scope, destinoEsPrivada)
      if (r === 'ok') movidos += 1
      else if (r === 'omitido') omitidos += 1
      else fallidos.push({ id: obj.id, nombre: obj.nombre, error: r })
    }
  }

  revalidatePath('/')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/familia')
  return { success: true, movidos, omitidos, fallidos, total: params.objetivos.length }
}

async function moverArchivo(
  supabase: Supa,
  userId: string,
  isAdmin: boolean,
  archivoId: string,
  nombre: string,
  destinoCarpetaId: string | null,
  scope: Scope
): Promise<'ok' | 'omitido' | string> {
  const { data: archivo } = await supabase
    .from('archivos')
    .select('id, nombre_original, ruta_r2, carpeta_id, subido_por, estado')
    .eq('id', archivoId)
    .single()
  if (!archivo) return 'Archivo no encontrado o sin permisos.'
  if (archivo.subido_por !== userId && !isAdmin) return 'Sin permiso para mover este archivo.'
  if (archivo.estado !== 'activo') return 'Solo se pueden mover archivos activos.'
  if ((archivo.carpeta_id ?? null) === destinoCarpetaId) return 'omitido'

  const scopeKey = scopeDeKey(archivo.ruta_r2)
  if (!scopeKey) return 'Ruta de almacenamiento no válida.'

  if (scopeKey !== scope && scopeKey !== 'publico') {
    // Cambio de ámbito: los bytes se mudan a una key del ámbito destino
    const nuevaKey = buildR2Key({ userId: archivo.subido_por, fileName: archivo.nombre_original, scope })
    try {
      await moverEnR2(archivo.ruta_r2, nuevaKey)
    } catch {
      return `No se pudo trasladar «${nombre}» en el almacenamiento.`
    }
    const { error: upError } = await supabase
      .from('archivos')
      .update({ ruta_r2: nuevaKey, carpeta_id: destinoCarpetaId })
      .eq('id', archivoId)
    if (upError) {
      // Reversión best-effort: devolver los bytes a su key original
      await moverEnR2(nuevaKey, archivo.ruta_r2).catch(() => {})
      return upError.message
    }
  } else if (scopeKey === 'publico' && scope !== 'comun') {
    return 'Este archivo heredado (ámbito público) solo puede moverse al Área común.'
  } else {
    const { error: upError } = await supabase
      .from('archivos')
      .update({ carpeta_id: destinoCarpetaId })
      .eq('id', archivoId)
    if (upError) return upError.message
  }

  await logActivity({
    accion: 'MOVER',
    detalles: { archivo_id: archivoId, nombre_original: nombre, de: archivo.carpeta_id, a: destinoCarpetaId },
  })
  return 'ok'
}

async function moverCarpeta(
  supabase: Supa,
  userId: string,
  isAdmin: boolean,
  carpetaId: string,
  destinoCarpetaId: string | null,
  scope: Scope,
  destinoEsPrivada: boolean | null
): Promise<'ok' | 'omitido' | string> {
  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, es_privada, carpeta_padre_id, creado_por')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return 'Carpeta no encontrada o sin permisos.'
  if (carpeta.creado_por !== userId && !isAdmin) return 'Sin permiso para mover esta carpeta.'
  if ((carpeta.carpeta_padre_id ?? null) === destinoCarpetaId) return 'omitido'
  if (destinoCarpetaId === carpetaId) return 'Una carpeta no puede moverse dentro de sí misma.'

  // Solo dentro del mismo ámbito: sus ficheros llevan keys ligadas a él
  const mismoAmbito = carpeta.es_privada === (scope === 'privado')
  if (!mismoAmbito || (destinoEsPrivada !== null && destinoEsPrivada !== carpeta.es_privada)) {
    return 'La carpeta no puede cambiar de ámbito: mueve antes su contenido.'
  }

  // Anti-ciclo: el destino no puede ser descendiente de la carpeta
  let cursor: string | null = destinoCarpetaId
  for (let i = 0; i < 50 && cursor; i++) {
    if (cursor === carpetaId) return 'No se puede mover una carpeta dentro de sí misma o sus hijas.'
    const idActual: string = cursor
    const { data: padre }: { data: { carpeta_padre_id: string | null } | null } = await supabase
      .from('carpetas')
      .select('carpeta_padre_id')
      .eq('id', idActual)
      .single()
    cursor = padre?.carpeta_padre_id ?? null
  }

  const { error: upError } = await supabase
    .from('carpetas')
    .update({ carpeta_padre_id: destinoCarpetaId })
    .eq('id', carpetaId)
  if (upError) return upError.message

  await logActivity({
    accion: 'MOVER',
    detalles: { carpeta_id: carpetaId, de: carpeta.carpeta_padre_id, a: destinoCarpetaId },
  })
  return 'ok'
}
