'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function crearCarpeta(params: {
  nombre: string
  esPrivada: boolean
  carpetaPadreId: string | null
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('carpetas').insert({
    nombre: params.nombre,
    creado_por: user.id,
    es_privada: params.esPrivada,
    carpeta_padre_id: params.carpetaPadreId,
  })

  if (error) return { error: error.message }
  revalidatePath('/')
  return { success: true }
}

export async function eliminarCarpeta(carpetaId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('carpetas').delete().eq('id', carpetaId)
  if (error) return { error: error.message }

  revalidatePath('/')
  return { success: true }
}

export async function listarCarpetas(carpetaPadreId: string | null = null) {
  const supabase = await createClient()

  const query = supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .order('fecha_creacion', { ascending: true })

  const { data, error } = carpetaPadreId
    ? await query.eq('carpeta_padre_id', carpetaPadreId)
    : await query.is('carpeta_padre_id', null)

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}
