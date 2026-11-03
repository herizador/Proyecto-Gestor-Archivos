'use server'

import { createClient } from '@/lib/supabase/server'
import { esUuidValido } from '@/lib/archivos-seguros'
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

  const titulo = String(params.titulo ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120)
  if (!titulo) return { error: 'Ponle un título al recordatorio.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.venceEl)) return { error: 'Fecha no válida.' }

  const archivoId = params.archivoId ?? null
  const carpetaId = params.carpetaId ?? null
  if (archivoId !== null && !esUuidValido(archivoId)) return { error: 'Archivo no válido.' }
  if (carpetaId !== null && !esUuidValido(carpetaId)) return { error: 'Carpeta no válida.' }
  if (archivoId !== null && carpetaId !== null) {
    return { error: 'Un recordatorio solo puede apuntar a un recurso.' }
  }

  const detalle = params.detalle
    ? String(params.detalle).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 280) || null
    : null

  const { error } = await supabase.from('recordatorios').insert({
    usuario_id: user.id,
    titulo,
    detalle,
    vence_el: params.venceEl,
    archivo_id: archivoId,
    carpeta_id: carpetaId,
  })
  if (error) return { error: 'No se pudo crear el recordatorio.' }

  revalidatePath('/inicio')
  return { success: true }
}

export async function completarRecordatorio(id: string, completado: boolean) {
  if (!esUuidValido(id)) return { error: 'Recordatorio no encontrado o sin permisos.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: actualizados, error } = await supabase
    .from('recordatorios')
    .update({ completado: completado === true })
    .eq('id', id)
    .select('id')
  if (error || !actualizados || actualizados.length === 0) {
    return { error: 'No se pudo actualizar el recordatorio.' }
  }

  revalidatePath('/inicio')
  return { success: true }
}

export async function eliminarRecordatorio(id: string) {
  if (!esUuidValido(id)) return { error: 'Recordatorio no encontrado o sin permisos.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: borrados, error } = await supabase
    .from('recordatorios')
    .delete()
    .eq('id', id)
    .select('id')
  if (error || !borrados || borrados.length === 0) {
    return { error: 'No se pudo eliminar el recordatorio.' }
  }

  revalidatePath('/inicio')
  return { success: true }
}
