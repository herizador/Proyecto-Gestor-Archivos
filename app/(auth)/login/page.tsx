'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ShieldCheck, Loader2, AlertTriangle } from 'lucide-react'
import { login } from '@/actions/auth'

function AvisoEnlace() {
  const params = useSearchParams()
  const motivo = params.get('error')
  if (motivo !== 'enlace' && motivo !== 'config') return null
  return (
    <div className="error-msg">
      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <span>
        {motivo === 'config'
          ? 'Falta configuración del servidor. Avisa al administrador.'
          : 'Ese enlace caducó, ya se usó o no es válido. Pide otra invitación.'}
      </span>
    </div>
  )
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    const formData = new FormData(e.currentTarget)
    const result = await login(formData)
    
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1 className="login-title">Acceso Seguro</h1>
            <p className="login-subtitle">Gestor de Archivos Familiar</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="form-group">
          <Suspense>
            <AvisoEnlace />
          </Suspense>
          {error && (
            <div className="error-msg">
              <span>{error}</span>
            </div>
          )}

          <div className="form-field">
            <label className="input-label" htmlFor="email">Correo Electrónico</label>
            <input 
              id="email" 
              name="email" 
              type="email" 
              className="input" 
              placeholder="tu@email.com" 
              required 
            />
          </div>

          <div className="form-field">
            <label className="input-label" htmlFor="password">Contraseña</label>
            <input 
              id="password" 
              name="password" 
              type="password" 
              className="input" 
              placeholder="••••••••" 
              required 
            />
          </div>

          <button 
            type="submit" 
            className="btn btn-primary btn-lg" 
            style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  )
}
