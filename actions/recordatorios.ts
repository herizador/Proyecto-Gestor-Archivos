'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Recordatorio } from '@/types/database'

// ---------------------------------------------------------------------------
// Recordatorios de vencimiento (portada /inicio). Personales: cada usuario ve
// los suyos (el admin, todos). NUNCA tocan archivos: solo avisan.
// ---------------------------------------------------------------------------
export async function listarRecordatorios(incluirCompletados = false) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as Recordatorio[] }

  let query = supabase
    .from('recordatorios')
    .select('*')
    .order('vence_el', { ascending: true })
    .order('fecha_creacion', { ascending: false })
  if (!incluirCompletados) query = query.eq('completado', false)

  const { data, error } = await query
  if (error) return { error: error.message, data: [] as Recordatorio[] }
  return { data: (data ?? []) as Recordatorio[] }
}

export async function crearRecordatorio(params: {
  titulo: string
  detalle?: string | null
  venceEl: string
  archivoId?: string | null
  carpetaId?: string | null
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const titulo = params.titulo.trim().slice(0, 120)
  if (!titulo) return { error: 'Ponle un título al recordatorio.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.venceEl)) return { error: 'Fecha no válida.' }

  const { error } = await supabase.from('recordatorios').insert({
    usuario_id: user.id,
    titulo,
    detalle: params.detalle?.trim().slice(0, 280) || null,
    vence_el: params.venceEl,
    archivo_id: params.archivoId ?? null,
    carpeta_id: params.carpetaId ?? null,
  })
  if (error) return { error: error.message }

  revalidatePath('/inicio')
  return { success: true }
}

export async function completarRecordatorio(id: string, completado: boolean) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('recordatorios').update({ completado }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inicio')
  return { success: true }
}

export async function eliminarRecordatorio(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('recordatorios').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inicio')
  return { success: true }
}
