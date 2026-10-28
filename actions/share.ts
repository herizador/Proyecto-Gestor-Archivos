'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import { archivosDeCarpetas } from '@/actions/seleccion'
import { getPresignedViewUrl } from '@/lib/r2/client'
import { revalidatePath } from 'next/cache'

// Tope de archivos dentro de un enlace: más allá, la página tendría que firmar
// cientos de URLs en cada visita. Los archivos elegidos a mano van primero.
const MAX_ARCHIVOS_ENLACE = 200

export async function generarEnlaceCompartido(params: {
  archivoIds: string[]
  carpetaIds: string[]
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  if (params.archivoIds.length === 0 && params.carpetaIds.length === 0) {
    return { error: 'Selecciona al menos un archivo o carpeta para compartir.' }
  }

  // Las carpetas aportan los archivos que contienen (incluidas subcarpetas).
  // Se guardan ya expandidas en archivos_ids: /compartir solo resuelve esa
  // lista y así los enlaces antiguos y nuevos funcionan igual.
  const seleccionados = [...new Set(params.archivoIds)]
  let dentroDeCarpetas: string[] = []
  let truncado = false
  if (params.carpetaIds.length > 0) {
    const contenido = await archivosDeCarpetas(params.carpetaIds, MAX_ARCHIVOS_ENLACE)
    if ('error' in contenido) return { error: contenido.error }
    dentroDeCarpetas = contenido.archivos.map((a) => a.id)
    truncado = contenido.truncado
  }

  let archivosIds = [...new Set([...seleccionados, ...dentroDeCarpetas])]
  if (archivosIds.length > MAX_ARCHIVOS_ENLACE) {
    archivosIds = archivosIds.slice(0, MAX_ARCHIVOS_ENLACE)
    truncado = true
  }

  if (archivosIds.length === 0) {
    return {
      error: params.carpetaIds.length > 0
        ? 'Las carpetas seleccionadas no contienen archivos.'
        : 'Selecciona al menos un archivo para compartir.',
    }
  }

  const token = crypto.randomUUID()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const shareUrl = `${baseUrl}/compartir?token=${token}`

  let tipoRecurso = 'multiple'
  if (seleccionados.length === 1 && params.carpetaIds.length === 0) tipoRecurso = 'archivo'
  else if (params.carpetaIds.length === 1 && seleccionados.length === 0) tipoRecurso = 'carpeta'

  const { error: insertError } = await supabase.from('enlaces_compartidos').insert({
    creado_por: user.id,
    tipo_recurso: tipoRecurso,
    archivos_ids: JSON.stringify(archivosIds),
    carpetas_ids: JSON.stringify(params.carpetaIds),
    token_acceso: token,
    expiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (insertError) return { error: insertError.message }

  await logActivity({
    accion: 'COMPARTIR_ENLACE',
    detalles: {
      token,
      tipo_recurso: tipoRecurso,
      archivos_ids: archivosIds,
      archivos_seleccionados: seleccionados,
      carpetas_ids: params.carpetaIds,
    },
  })

  revalidatePath('/')
  return {
    url: shareUrl,
    token,
    totalArchivos: archivosIds.length,
    aviso: truncado
      ? `El enlace incluye los primeros ${MAX_ARCHIVOS_ENLACE} archivos de las carpetas seleccionadas.`
      : undefined,
  }
}

export async function obtenerEnlaceCompartido(token: string) {
  const supabase = await createClient()

  const { data: enlace, error } = await supabase
    .from('enlaces_compartidos')
    .select('*')
    .eq('token_acceso', token)
    .single()

  if (error || !enlace) return { error: 'Enlace no válido o expirado.' }

  if (enlace.expiracion && new Date(enlace.expiracion) < new Date()) {
    return { error: 'Este enlace ha expirado.' }
  }

  let archivoIds: string[] = []
  try {
    archivoIds = typeof enlace.archivos_ids === 'string'
      ? JSON.parse(enlace.archivos_ids)
      : (enlace.archivos_ids as string[])
  } catch {
    archivoIds = []
  }

  // Enlaces antiguos: solo guardaban carpetas_ids. Se expanden al leer para
  // que sigan mostrando el contenido de la carpeta.
  if (archivoIds.length === 0) {
    let carpetaIds: string[] = []
    try {
      carpetaIds = typeof enlace.carpetas_ids === 'string'
        ? JSON.parse(enlace.carpetas_ids)
        : (enlace.carpetas_ids as string[])
    } catch {
      carpetaIds = []
    }
    if (carpetaIds.length > 0) {
      const contenido = await archivosDeCarpetas(carpetaIds, MAX_ARCHIVOS_ENLACE)
      if (!('error' in contenido)) {
        archivoIds = contenido.archivos.map((a) => a.id)
      }
    }
  }

  if (archivoIds.length === 0) return { error: 'No hay archivos en este enlace.', enlace }

  const { data: archivos } = await supabase
    .from('archivos')
    .select('id, nombre_original, ruta_r2, tamano_bytes, tipo_mime')
    .in('id', archivoIds)
    .eq('estado', 'activo')

  const archivosConUrl = await Promise.all(
    (archivos ?? []).map(async (archivo) => {
      try {
        const url = await getPresignedViewUrl(archivo.ruta_r2, archivo.tipo_mime)
        return { ...archivo, url }
      } catch {
        return { ...archivo, url: null }
      }
    })
  )

  return { enlace, archivos: archivosConUrl }
}
