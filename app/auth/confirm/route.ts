import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { crearServiceClient } from '@/lib/supabase/service'

const TIPOS_VALIDOS: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']
const RECLAMO_MINUTOS = 30

// Intercambia el token del email por acceso.
// - type=invite: el enlace SOLO autoriza a definir la contraseña (nunca a
//   navegar). Se canjea el OTP, se cierra la sesión de inmediato y se emite un
//   reclamo de un solo uso (cookie HttpOnly, 30 min) para /establecer-password.
// - otros tipos (p. ej. recovery): flujo clásico con sesión + `next` validado.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const token_hash = params.get('token_hash')
  const type = params.get('type')
  const pedido = params.get('next') ?? '/'
  const next = pedido.startsWith('/') && !pedido.startsWith('//') ? pedido : '/'

  if (token_hash && type && (TIPOS_VALIDOS as string[]).includes(type)) {
    if (type === 'invite') {
      return gestionarInvitacion(request, token_hash)
    }
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as EmailOtpType })
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  return NextResponse.redirect(new URL('/login?error=enlace', request.url))
}

async function gestionarInvitacion(request: NextRequest, token_hash: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'invite' })
  if (error || !data.user) {
    return NextResponse.redirect(new URL('/login?error=enlace', request.url))
  }
  // La sesión de la invitación no debe servir para navegar: se cierra aquí.
  await supabase.auth.signOut()

  const servicio = crearServiceClient()
  if (!servicio) {
    return NextResponse.redirect(new URL('/login?error=config', request.url))
  }
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  const { error: insertError } = await servicio.from('invitaciones_pendientes').insert({
    usuario_id: data.user.id,
    token_hash: hash,
    expira: new Date(Date.now() + RECLAMO_MINUTOS * 60 * 1000).toISOString(),
  })
  if (insertError) {
    return NextResponse.redirect(new URL('/login?error=enlace', request.url))
  }

  const res = NextResponse.redirect(new URL('/establecer-password', request.url))
  res.cookies.set('inv_claim', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: RECLAMO_MINUTOS * 60,
  })
  return res
}
