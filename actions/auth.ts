'use server'

import { createClient } from '@/lib/supabase/server'
import { crearServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { logLogin } from './storage' // Usamos logLogin que ya creamos

export async function login(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const recordar = formData.get('recordar') === 'on'

  if (!email || !password) {
    return { error: 'Email y contraseña son obligatorios.' }
  }

  // Sin "Recordar este dispositivo" la sesión se emite como cookie de sesión:
  // desaparece al cerrar el navegador.
  const supabase = await createClient({ sesionTemporal: !recordar })

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  // Marca de preferencia (sin secretos). El middleware la lee para no devolver
  // la caducidad larga a las cookies de sesión cuando refresca el token.
  const jar = await cookies()
  if (recordar) {
    jar.set('recordar_equipo', '', { path: '/', maxAge: 0 })
  } else {
    jar.set('recordar_equipo', 'no', {
      path: '/',
      sameSite: 'lax',
      maxAge: 400 * 24 * 60 * 60,
    })
  }

  // Registramos el login en el historial de forma asíncrona
  await logLogin()

  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const jar = await cookies()
  jar.set('recordar_equipo', '', { path: '/', maxAge: 0 })
  redirect('/login')
}

// ---------------------------------------------------------------------------
// Define la contraseña del invitado usando su reclamo (cookie inv_claim).
// El reclamo autoriza SOLO esta acción, una vez y 30 min; no existe sesión.
// Tras fijarla se marca usado, se borra la cookie y se entra con login normal.
// ---------------------------------------------------------------------------
export async function definirPasswordInvitacion(password: string) {
  if (!password || password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' }
  }

  const servicio = crearServiceClient()
  if (!servicio) return { error: 'Servicio no configurado.' }

  const jar = await cookies()
  const token = jar.get('inv_claim')?.value
  if (!token) return { error: 'Reclamo no válido. Pide otra invitación.' }

  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(token).digest('hex')

  const { data: reclamo } = await servicio
    .from('invitaciones_pendientes')
    .select('id, usuario_id, usada, expira')
    .eq('token_hash', hash)
    .single()
  if (!reclamo || reclamo.usada || new Date(reclamo.expira) < new Date()) {
    return { error: 'Reclamo caducado o ya usado. Pide otra invitación.' }
  }

  const { data: { user }, error: userError } = await servicio.auth.admin.getUserById(reclamo.usuario_id)
  if (userError || !user?.email) return { error: 'Cuenta no válida. Pide otra invitación.' }

  const { error: passError } = await servicio.auth.admin.updateUserById(reclamo.usuario_id, { password })
  if (passError) return { error: passError.message }

  await servicio.from('invitaciones_pendientes').update({ usada: true }).eq('id', reclamo.id)
  jar.set('inv_claim', '', { maxAge: 0, path: '/' })

  // Entrada normal con la contraseña recién creada (ya demostrada por el dueño)
  const supabase = await createClient()
  const { error: loginError } = await supabase.auth.signInWithPassword({ email: user.email, password })
  if (loginError) redirect('/login')

  await logLogin()
  redirect('/')
}
