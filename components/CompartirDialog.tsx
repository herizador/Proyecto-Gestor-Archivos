'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus, Loader2, Trash2 } from 'lucide-react'
import {
  compartirCon, dejarDeCompartir, listarConQuienComparto, listarMiembros,
} from '@/actions/compartir-usuarios'
import { avisar } from '@/components/Avisos'

// Diálogo "Compartir con un miembro" (cesión nominal, no enlace público).
// Controlado por el padre (el ⋯ de cada tarjeta): abierto + alCerrar.
export default function CompartirDialog({
  tipo,
  id,
  nombre,
  abierto,
  alCerrar,
}: {
  tipo: 'archivo' | 'carpeta'
  id: string
  nombre: string
  abierto: boolean
  alCerrar: () => void
}) {
  const [miembros, setMiembros] = useState<Array<{ id: string; nombre: string }>>([])
  const [elegido, setElegido] = useState('')
  const [cesiones, setCesiones] = useState<Array<{ id: string; nombre: string }>>([])
  const [cargados, setCargados] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', onKey)
    }
  }, [abierto, alCerrar])

  // Carga diferida al abrir (los setState viven en el .then, no en el efecto)
  useEffect(() => {
    if (!abierto) return
    let cancelado = false
    void Promise.all([listarMiembros(), listarConQuienComparto({ tipo, id })])
      .then(([m, c]) => {
        if (cancelado) return
        if ('error' in m && m.error) avisar('error', m.error)
        else setMiembros(m.data ?? [])
        if ('error' in c && c.error) avisar('error', c.error)
        else setCesiones(c.data ?? [])
        setCargados(true)
      })
      .catch(() => {
        if (cancelado) return
        avisar('error', 'No se pudo cargar.')
        setCargados(true)
      })
    return () => {
      cancelado = true
    }
  }, [abierto, tipo, id])

  function cerrar() {
    setCargados(false)
    setElegido('')
    alCerrar()
  }

  async function handleCompartir() {
    if (!elegido) return
    setGuardando(true)
    const res = await compartirCon({ tipo, id, usuarioId: elegido })
    setGuardando(false)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    if ('duplicado' in res && res.duplicado) avisar('info', 'Ya estaba compartido con ese miembro.')
    else avisar('exito', 'Compartido.')
    setElegido('')
    const c = await listarConQuienComparto({ tipo, id })
    if (!('error' in c) || !c.error) setCesiones((c as { data: Array<{ id: string; nombre: string }> }).data ?? [])
  }

  async function handleRevocar(usuarioId: string) {
    const res = await dejarDeCompartir({ tipo, id, usuarioId })
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    avisar('exito', 'Cesión revocada.')
    setCesiones((prev) => prev.filter((c) => c.id !== usuarioId))
  }

  if (!abierto || typeof document === 'undefined') return null
  return createPortal(
    <div className="modal-overlay" onClick={cerrar}>
      <div
        className="modal modal-enlace"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Compartir ${nombre}`}
      >
        <div className="modal-header">
          <h2 className="modal-title">Compartir «{nombre}»</h2>
          <button onClick={cerrar} className="btn-ghost btn-icon" type="button" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
          Solo ese miembro podrá verlo (no es un enlace público).
        </p>

        {!cargados ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            <div className="skeleton" aria-hidden="true" />
            <div className="skeleton" aria-hidden="true" />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <select
                className="input"
                value={elegido}
                onChange={(e) => setElegido(e.target.value)}
                aria-label="Miembro con quien compartir"
                style={{ flex: 1, minWidth: '180px' }}
              >
                <option value="">Elige un miembro…</option>
                {miembros.filter((m) => !cesiones.some((c) => c.id === m.id)).map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCompartir}
                disabled={guardando || !elegido}
                style={{ minHeight: '44px' }}
              >
                {guardando ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Compartir
              </button>
            </div>

            {cesiones.length > 0 && (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cesiones.map((c) => (
                  <li
                    key={c.id}
                    className="card"
                    style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                      {c.nombre}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleRevocar(c.id)}
                      style={{ minHeight: '36px', flexShrink: 0 }}
                      title="Dejar de compartir con este miembro"
                    >
                      <Trash2 size={14} /> Revocar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
