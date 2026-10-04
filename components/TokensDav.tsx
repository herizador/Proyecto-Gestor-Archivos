'use client'

import { useState } from 'react'
import { KeyRound, Copy, Check, Ban, Trash2, Loader2 } from 'lucide-react'
import { crearTokenDav, revocarTokenDav, eliminarTokenDav, type TokenDavVisible } from '@/actions/dav'
import DateDisplay from '@/components/DateDisplay'

// Gestión de tokens de Explorador (puente WebDAV): crear, mostrar una sola vez,
// revocar y eliminar. El admin ve además a quién pertenece cada token.
export default function TokensDav({
  iniciales,
  isAdmin,
}: {
  iniciales: TokenDavVisible[]
  isAdmin: boolean
}) {
  const [tokens, setTokens] = useState<TokenDavVisible[]>(iniciales)
  const [nombre, setNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [tokenNuevo, setTokenNuevo] = useState<{ id: string; token: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)

  async function handleCrear() {
    if (!nombre.trim()) {
      setError('Ponle un nombre (p. ej. "Portátil trabajo").')
      return
    }
    setCreando(true)
    setError(null)
    const res = await crearTokenDav(nombre.trim())
    setCreando(false)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    if ('success' in res && res.success) {
      setTokenNuevo({ id: res.id as string, token: res.token as string })
      setNombre('')
      setTokens((prev) => [
        { id: res.id as string, nombre: nombre.trim(), revocado: false, ultimo_uso: null, fecha_creacion: new Date().toISOString(), propietario: null },
        ...prev,
      ])
    }
  }

  async function handleCopiar() {
    if (!tokenNuevo) return
    try {
      await navigator.clipboard.writeText(tokenNuevo.token)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError('No se pudo copiar al portapapeles: selecciónalo a mano.')
    }
  }

  async function handleRevocar(id: string) {
    if (!confirm('¿Revocar este token? Ese dispositivo dejará de ver tus archivos.')) return
    setProcesando(id)
    const res = await revocarTokenDav(id)
    setProcesando(null)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revocado: true } : t)))
  }

  async function handleEliminar(id: string) {
    if (!confirm('¿Eliminar este token definitivamente?')) return
    setProcesando(id)
    const res = await eliminarTokenDav(id)
    setProcesando(null)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div>
      {error && (
        <div className="error-msg" style={{ marginBottom: '12px' }}>
          <span>{error}</span>
        </div>
      )}

      {tokenNuevo && (
        <div style={{ padding: '12px 16px', marginBottom: '12px', background: 'var(--color-accent-dim)', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 'var(--radius-md)' }}>
          <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
            Cópiala ahora: no volverá a mostrarse
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="text" className="input" value={tokenNuevo.token} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopiar} style={{ minHeight: '36px', flexShrink: 0 }}>
              {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? '¡Copiado!' : 'Copiar'}
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTokenNuevo(null)} style={{ marginTop: '8px' }}>
            Ya la guardé
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="input"
          placeholder='Nombre del dispositivo (p. ej. "Portátil trabajo")'
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={60}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <button type="button" className="btn btn-primary" onClick={handleCrear} disabled={creando} style={{ minHeight: '44px' }}>
          {creando ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Crear contraseña
        </button>
      </div>

      {tokens.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Aún no tienes contraseñas de Explorador.
        </p>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tokens.map((t) => (
            <li
              key={t.id}
              className="card"
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', opacity: t.revocado ? 0.6 : 1 }}
            >
              <div style={{ flex: 1, minWidth: '160px' }}>
                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {t.nombre} {t.revocado && <span className="badge badge-papelera" style={{ marginLeft: '6px' }}>revocado</span>}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Creado <DateDisplay date={t.fecha_creacion} />
                  {t.ultimo_uso ? <> · usado <DateDisplay date={t.ultimo_uso} /></> : ' · sin usar aún'}
                  {isAdmin && t.propietario ? ` · ${t.propietario}` : ''}
                </p>
              </div>
              {!t.revocado && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleRevocar(t.id)}
                  disabled={procesando === t.id}
                  style={{ minHeight: '36px' }}
                  title="Revocar: ese dispositivo pierde el acceso"
                >
                  <Ban size={14} /> Revocar
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleEliminar(t.id)}
                disabled={procesando === t.id}
                style={{ minHeight: '36px' }}
                title="Eliminar definitivamente"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
