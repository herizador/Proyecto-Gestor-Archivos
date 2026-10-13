import { cookies } from 'next/headers'
import { createHash } from 'node:crypto'
import { AlertTriangle } from 'lucide-react'
import { crearServiceClient } from '@/lib/supabase/service'
import EstablecerPasswordForm from '@/components/EstablecerPasswordForm'

// Llegada del enlace de invitación (vía /auth/confirm): aquí NO hay sesión.
// Solo se muestra el formulario si el reclamo (cookie inv_claim) es válido:
// pendiente, sin usar y sin caducar. Si no, hay que pedir otra invitación.
export default async function EstablecerPasswordPage() {
  const token = (await cookies()).get('inv_claim')?.value
  let email: string | null = null

  if (token) {
    const servicio = crearServiceClient()
    if (servicio) {
      const hash = createHash('sha256').update(token).digest('hex')
      const { data: reclamo } = await servicio
        .from('invitaciones_pendientes')
        .select('usuario_id, usada, expira')
        .eq('token_hash', hash)
        .single()
      if (reclamo && !reclamo.usada && new Date(reclamo.expira) >= new Date()) {
        const { data: { user } } = await servicio.auth.admin.getUserById(reclamo.usuario_id)
        email = user?.email ?? null
      }
    }
  }

  if (!email) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Enlace no válido</h1>
          <p className="login-subtitle">
            Este enlace caducó, ya se usó o no existe. Por seguridad los enlaces
            de invitación son de un solo uso y duran 30 minutos. Pide al
            administrador que te invite de nuevo.
          </p>
          <a className="btn btn-primary" href="/login" style={{ marginTop: '16px', textDecoration: 'none' }}>
            Ir al login
          </a>
        </div>
      </div>
    )
  }

  return <EstablecerPasswordForm email={email} />
}
