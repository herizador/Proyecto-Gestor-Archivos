'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import { getPresignedViewUrl } from '@/lib/r2/client'
import { revalidatePath } from 'next/cache'

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

  const token = crypto.randomUUID()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const shareUrl = `${baseUrl}/compartir?token=${token}`

  let tipoRecurso = 'multiple'
  if (params.archivoIds.length === 1 && params.carpetaIds.length === 0) tipoRecurso = 'archivo'
  else if (params.carpetaIds.length === 1 && params.archivoIds.length === 0) tipoRecurso = 'carpeta'

  const { error: insertError } = await supabase.from('enlaces_compartidos').insert({
    creado_por: user.id,
    tipo_recurso: tipoRecurso,
    archivos_ids: JSON.stringify(params.archivoIds),
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
      archivos_ids: params.archivoIds,
      carpetas_ids: params.carpetaIds,
    },
  })

  revalidatePath('/')
  return { url: shareUrl, token }
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
