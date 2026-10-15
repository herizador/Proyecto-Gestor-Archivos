'use server'

import { createClient } from '@/lib/supabase/server'
import type { ActivityAction, HistorialConPerfil, Json } from '@/types/database'

export async function logActivity(params: {
  accion: ActivityAction
  detalles?: Json
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('historial_actividad').insert({
    usuario_id: user.id,
    accion: params.accion,
    detalles: params.detalles ?? null,
  })
}

export async function logLogin() {
  return logActivity({ accion: 'LOGIN' })
}

export async function logLogout() {
  return logActivity({ accion: 'LOGOUT' })
}

// ---------------------------------------------------------------------------
// Actividad reciente para la portada, con privacidad por rol: el admin ve la
// global; el resto solo la suya (mostrar la ajena filtraría actividad privada,
// p. ej. subidas a cajas fuertes ajenas). La policy historial_select_propio
// respalda al miembro; el admin usa la de admin.
// ---------------------------------------------------------------------------
export async function listarActividadReciente(limite = 8) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as HistorialConPerfil[], isAdmin: false }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  let query = supabase
    .from('historial_actividad')
    .select('*, perfiles(nombre_completo, avatar_url)')
    .order('fecha_evento', { ascending: false })
    .limit(limite)
  if (!isAdmin) query = query.eq('usuario_id', user.id)

  const { data, error } = await query
  if (error) return { error: error.message, data: [] as HistorialConPerfil[], isAdmin }
  return { data: (data ?? []) as HistorialConPerfil[], isAdmin }
}
