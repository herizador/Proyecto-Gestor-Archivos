'use server'

import { createClient } from '@/lib/supabase/server'
import type { ActivityAction, Json } from '@/types/database'

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
