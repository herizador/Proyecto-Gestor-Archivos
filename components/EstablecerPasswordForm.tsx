'use client'

import { useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { definirPasswordInvitacion } from '@/actions/auth'

// El invitado define su contraseña amparado por su reclamo (cookie inv_claim).
// No hay sesión en este punto: el enlace por sí solo nunca da acceso a la app.
export default function EstablecerPasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setLoading(true)
    // Éxito = redirect('/') desde la acción; si vuelve, es que hubo error
    const result = await definirPasswordInvitacion(password)
    setLoading(false)
    if (result?.error) setError(result.error)
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1 className="login-title">Crea tu contraseña</h1>
            <p className="login-subtitle">Hola, {email}. Solo te lo pediremos una vez.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="form-group">
          {error && (
            <div className="error-msg">
              <span>{error}</span>
            </div>
          )}

          <div className="form-field">
            <label className="input-label" htmlFor="password">Nueva contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <div className="form-field">
            <label className="input-label" htmlFor="confirmacion">Repite la contraseña</label>
            <input
              id="confirmacion"
              name="password-confirm"
              type="password"
              className="input"
              placeholder="••••••••"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Guardar y entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
