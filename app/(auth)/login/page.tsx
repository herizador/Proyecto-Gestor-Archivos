'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Sparkles,
  Lock,
  FolderCheck,
  Mail,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react'
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
  const [verPassword, setVerPassword] = useState(false)
  const [recordar, setRecordar] = useState(true)
  const [aviso, setAviso] = useState<'password' | 'ayuda' | null>(null)

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
    <div className="login-split">
      {/* PANEL IZQUIERDO — relato (en móvil queda solo la marca) */}
      <aside className="login-aside">
        <div className="login-marca">
          <div className="login-marca-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="login-marca-nombre">Archivo Familiar</div>
            <div className="login-marca-sub">Gestor privado</div>
          </div>
        </div>

        <div className="login-relato">
          <p className="eyebrow login-eyebrow">
            <Sparkles size={12} /> El archivo de nuestra familia
          </p>
          <h2 className="login-eslogan">
            Todo lo nuestro,
            <br />
            <span className="login-eslogan-acento">en un mismo lugar.</span>
          </h2>
          <p className="login-prosa">
            Los documentos importantes, los recuerdos y las cosas del día a día,
            ordenados para toda la familia.
          </p>

          <ul className="login-rasgos">
            <li>
              <span className="login-rasgo-icon">
                <Lock size={16} />
              </span>
              <span className="login-rasgo-texto">
                <strong>Solo para la familia</strong>
                Nuestro espacio privado.
              </span>
            </li>
            <li>
              <span className="login-rasgo-icon">
                <FolderCheck size={16} />
              </span>
              <span className="login-rasgo-texto">
                <strong>Todo en su sitio</strong>
                Fácil de encontrar.
              </span>
            </li>
          </ul>
        </div>

        <div className="login-pie">
          <div className="login-pie-avatares" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="login-pie-titulo">Nuestro rincón familiar</div>
            <div className="login-pie-sub">Un espacio privado, solo para los nuestros.</div>
          </div>
        </div>
      </aside>

      {/* PANEL DERECHO — formulario */}
      <main className="login-principal">
        <div className="login-card">
          <div className="login-head">
            <div className="login-logo-icon">
              <ShieldCheck size={26} />
            </div>
            <p className="eyebrow login-eyebrow-centrado">Qué bueno verte</p>
            <h1 className="login-title">Hola de nuevo</h1>
            <p className="login-subtitle">Entra para ver las cosas de casa.</p>
          </div>

          <form onSubmit={handleSubmit} className="form-group">
            <Suspense>
              <AvisoEnlace />
            </Suspense>
            {error && (
              <div className="error-msg">
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-field">
              <label className="input-label" htmlFor="email">
                Correo electrónico
              </label>
              <div className="campo-icono">
                <Mail size={16} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  placeholder="tu@email.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="form-field">
              <div className="fila-etiqueta">
                <label className="input-label" htmlFor="password">
                  Contraseña
                </label>
                <button
                  type="button"
                  className="enlace-sutil"
                  onClick={() => setAviso(aviso === 'password' ? null : 'password')}
                  aria-expanded={aviso === 'password'}
                >
                  ¿La has olvidado?
                </button>
              </div>
              <div className="campo-icono">
                <Lock size={16} />
                <input
                  id="password"
                  name="password"
                  type={verPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="btn-ojo"
                  onClick={() => setVerPassword((v) => !v)}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {verPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {aviso === 'password' && (
              <p className="nota-aviso">
                No hay recuperación por correo: pide al administrador una
                invitación nueva. Llegará un enlace con el que fijarás otra
                contraseña.
              </p>
            )}

            <label className="fila-check" htmlFor="recordar">
              <input
                id="recordar"
                name="recordar"
                type="checkbox"
                className="checkbox-input"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
              />
              <span>Recordar este dispositivo</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary btn-lg login-boton"
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  Entrar al archivo
                  <ChevronRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="login-card-pie">
            <span className="login-card-pie-item">
              <Lock size={12} /> Espacio privado familiar
            </span>
            <button
              type="button"
              className="enlace-sutil"
              onClick={() => setAviso(aviso === 'ayuda' ? null : 'ayuda')}
              aria-expanded={aviso === 'ayuda'}
            >
              ¿Problemas para entrar?
            </button>
          </div>

          {aviso === 'ayuda' && (
            <p className="nota-aviso">
              Comprueba que el correo esté bien escrito y que sea el mismo de tu
              invitación. Si sigue sin dejarte, pide al administrador que te
              invite otra vez: el enlace es de un solo uso.
            </p>
          )}
        </div>

        <p className="login-hecho">Hecho para la familia</p>
      </main>
    </div>
  )
}
