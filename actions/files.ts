'use server'

import { createClient } from '@/lib/supabase/server'
import { getPresignedUploadUrl, getPresignedViewUrl, getPresignedDownloadUrl, deleteFromR2, buildR2Key } from '@/lib/r2/client'
import { logActivity } from '@/actions/storage'
import type { ArchivoConAutor } from '@/types/database'
import { revalidatePath } from 'next/cache'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

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
  if (params.fileSize > MAX_FILE_SIZE) {
    return { error: 'El archivo supera el límite de 20 MB permitido.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const key = buildR2Key({ userId: user.id, fileName: params.fileName, scope: params.scope })

  try {
    const uploadUrl = await getPresignedUploadUrl(key, params.contentType)
    return { uploadUrl, key }
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

  const { error } = await supabase.from('archivos').insert({
    nombre_original: params.nombreOriginal,
    ruta_r2: params.rutaR2,
    tamano_bytes: params.tamanoBytes,
    tipo_mime: params.tipoMime,
    carpeta_id: params.carpetaId,
    subido_por: user.id,
    estado: 'activo',
  })

  if (error) {
    // El trigger de 9 GB devuelve un mensaje específico
    if (error.message.includes('LIMITE_ALMACENAMIENTO')) {
      return { error: 'El almacenamiento familiar ha alcanzado el límite de 9 GB. Contacta al administrador.' }
    }
    return { error: error.message }
  }

  revalidatePath('/')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Obtener URL pre-firmada para visualizar + auditar
// ---------------------------------------------------------------------------
export async function visualizarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: archivo, error } = await supabase
    .from('archivos')
    .select('ruta_r2, nombre_original')
    .eq('id', archivoId)
    .eq('estado', 'activo')
    .single()

  if (error || !archivo) return { error: 'Archivo no encontrado o sin permisos.' }

  try {
    const url = await getPresignedViewUrl(archivo.ruta_r2)

    await logActivity({
      accion: 'VISUALIZAR_ARCHIVO',
      detalles: {
        archivo_id: archivoId,
        nombre_original: archivo.nombre_original,
      },
    })

    return { url }
  } catch {
    return { error: 'Error al generar enlace de visualización.' }
  }
}

// ---------------------------------------------------------------------------
// Obtener URL pre-firmada de descarga + auditar
// ---------------------------------------------------------------------------
export async function descargarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: archivo, error } = await supabase
    .from('archivos')
    .select('ruta_r2, nombre_original')
    .eq('id', archivoId)
    .eq('estado', 'activo')
    .single()

  if (error || !archivo) return { error: 'Archivo no encontrado o sin permisos.' }

  try {
    const url = await getPresignedDownloadUrl(archivo.ruta_r2, archivo.nombre_original)

    await logActivity({
      accion: 'DESCARGAR_ARCHIVO',
      detalles: {
        archivo_id: archivoId,
        nombre_original: archivo.nombre_original,
      },
    })

    return { url, nombreOriginal: archivo.nombre_original }
  } catch {
    return { error: 'Error al generar enlace de descarga.' }
  }
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

  const { error } = await supabase
    .from('archivos')
    .update({ estado: 'papelera', fecha_papelera: new Date().toISOString() })
    .eq('id', archivoId)

  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Restaurar archivo de la papelera
// ---------------------------------------------------------------------------
export async function restaurarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase
    .from('archivos')
    .update({ estado: 'activo', fecha_papelera: null })
    .eq('id', archivoId)

  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Eliminar archivo permanentemente (solo admin)
// ---------------------------------------------------------------------------
export async function eliminarArchivoPermanente(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  if (perfil?.rol !== 'admin') return { error: 'Solo el administrador puede eliminar permanentemente.' }

  const { data: archivo, error: fetchError } = await supabase
    .from('archivos')
    .select('ruta_r2, nombre_original')
    .eq('id', archivoId)
    .single()

  if (fetchError || !archivo) return { error: 'Archivo no encontrado.' }

  // 1. Borrar de R2
  await deleteFromR2(archivo.ruta_r2)

  // 2. Borrar de BD
  const { error } = await supabase.from('archivos').delete().eq('id', archivoId)
  if (error) return { error: error.message }

  await logActivity({
    accion: 'ELIMINAR_PERMANENTE',
    detalles: {
      archivo_id: archivoId,
      nombre_original: archivo.nombre_original,
    },
  })

  revalidatePath('/')
  revalidatePath('/papelera')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
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
