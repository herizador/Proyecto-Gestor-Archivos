'use server'

import { createClient } from '@/lib/supabase/server'
import { getPresignedUploadUrl, getPresignedViewUrl, getPresignedDownloadUrl, deleteFromR2, buildR2Key } from '@/lib/r2/client'
import { logActivity } from '@/actions/storage'
import type { ArchivoConAutor } from '@/types/database'
import { revalidatePath } from 'next/cache'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

type Scope = 'comun' | 'publico' | 'privado'

// Infiere el scope desde el prefijo físico de la key R2
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
  carpetaId: string | null,
  scope: Scope
): Promise<{ error?: string; scope: Scope }> {
  if (!carpetaId) return { scope }
  const { data: carpeta, error } = await supabase
    .from('carpetas')
    .select('id, es_privada')
    .eq('id', carpetaId)
    .single()
  if (error || !carpeta) return { error: 'Carpeta de destino no válida.', scope }
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
  if (params.fileSize > MAX_FILE_SIZE) {
    return { error: 'El archivo supera el límite de 20 MB permitido.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const validacion = await validarCarpetaDestino(supabase, params.carpetaId, params.scope)
  if (validacion.error) return { error: validacion.error }

  const key = buildR2Key({ userId: user.id, fileName: params.fileName, scope: validacion.scope })

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

  // Defensa en profundidad: la key debe declarar un scope válido y concordar
  // con la carpeta (una key 'comun/...' no puede colgarse de carpeta privada).
  const scopeKey = scopeDeKey(params.rutaR2)
  if (!scopeKey) return { error: 'Ruta de almacenamiento no válida.' }
  const validacion = await validarCarpetaDestino(supabase, params.carpetaId, scopeKey)
  if (validacion.error) return { error: validacion.error }

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
  const { data: acceso } = await supabase
    .from('accesos_directos')
    .select(`
      id,
      archivo_objetivo:archivos!accesos_directos_archivo_objetivo_id_fkey(
        id, ruta_r2, nombre_original, tipo_mime, estado
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
    .select('id, ruta_r2, nombre_original, tipo_mime')
    .eq('id', idVisible)
    .eq('estado', 'activo')
    .single()

  if (error || !archivo) return { error: 'Archivo no encontrado o sin permisos.' }
  return { ...archivo, originalId: archivo.id, accesoId: null }
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
export async function enviarArchivo(archivoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const resuelto = await resolverObjetivo(supabase, archivoId)
  if ('error' in resuelto) return { error: resuelto.error }

  try {
    const url = await getPresignedDownloadUrl(resuelto.ruta_r2, resuelto.nombre_original)

    await logActivity({
      accion: 'COMPARTIR_EXTERNO',
      detalles: {
        archivo_id: resuelto.originalId,
        nombre_original: resuelto.nombre_original,
        ...(resuelto.accesoId ? { acceso_id: resuelto.accesoId } : {}),
      },
    })

    return { url, nombreOriginal: resuelto.nombre_original, tipoMime: resuelto.tipo_mime }
  } catch {
    return { error: 'Error al preparar el archivo para enviar.' }
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

  // Contar enlaces que quedarán huérfanos (SET NULL) para la auditoría
  const { count: enlacesAfectados } = await supabase
    .from('accesos_directos')
    .select('id', { count: 'exact', head: true })
    .eq('archivo_objetivo_id', archivoId)

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
      enlaces_huerfanos: enlacesAfectados ?? 0,
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
