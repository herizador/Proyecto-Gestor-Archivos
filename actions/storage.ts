'use server'

import { createClient } from '@/lib/supabase/server'

export async function logActivity(params: {
  accion: string
  detalles?: Record<string, unknown>
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
