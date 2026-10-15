'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, BellPlus, Loader2 } from 'lucide-react'
import { crearRecordatorio } from '@/actions/recordatorios'
import { avisar } from '@/components/Avisos'

function fechaDentroDe(dias: number): string {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

// Crear recordatorio (desde la portada o desde el ⋯ con recurso prefijado).
// Nunca toca archivos: solo avisa cuando vence.
export default function RecordatorioModal({
  abierto,
  alCerrar,
  preset = null,
  onGuardado,
}: {
  abierto: boolean
  alCerrar: () => void
  preset?: { tipo: 'archivo' | 'carpeta'; id: string; nombre: string } | null
  onGuardado?: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [fecha, setFecha] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cerrar = useCallback(() => {
    setTitulo(preset ? `Renovar ${preset.nombre}` : '')
    setDetalle('')
    setFecha(fechaDentroDe(30))
    alCerrar()
  }, [preset, alCerrar])

  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', onKey)
    }
  }, [abierto, cerrar])

  async function handleGuardar() {
    if (!titulo.trim()) {
      avisar('error', 'Ponle un título al recordatorio.')
      return
    }
    if (!fecha) {
      avisar('error', 'Elige la fecha de vencimiento.')
      return
    }
    setGuardando(true)
    const res = await crearRecordatorio({
      titulo: titulo.trim(),
      detalle: detalle.trim() || null,
      venceEl: fecha,
      archivoId: preset?.tipo === 'archivo' ? preset.id : null,
      carpetaId: preset?.tipo === 'carpeta' ? preset.id : null,
    })
    setGuardando(false)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    avisar('exito', 'Recordatorio creado.')
    onGuardado?.()
    cerrar()
  }

  if (!abierto || typeof document === 'undefined') return null
  return createPortal(
    <div className="modal-overlay" onClick={cerrar}>
      <div
        className="modal modal-enlace"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo recordatorio"
      >
        <div className="modal-header">
          <h2 className="modal-title">Nuevo recordatorio</h2>
          <button onClick={cerrar} className="btn-ghost btn-icon" type="button" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
          {preset ? (
            <>Avisará del vencimiento de <strong>«{preset.nombre}»</strong> sin tocar el archivo.</>
          ) : (
            <>Avisará en la portada cuando llegue la fecha, sin tocar nada.</>
          )}
        </p>

        <div style={{ marginBottom: '12px' }}>
          <label className="input-label" htmlFor="rec-titulo">Título</label>
          <input
            id="rec-titulo"
            type="text"
            className="input"
            placeholder="p. ej. Renovar el seguro"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label className="input-label" htmlFor="rec-detalle">Detalle (opcional)</label>
          <input
            id="rec-detalle"
            type="text"
            className="input"
            placeholder="p. ej. Vence la póliza anual"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            maxLength={280}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label className="input-label" htmlFor="rec-fecha">Vence el</label>
          <input
            id="rec-fecha"
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{ maxWidth: '220px' }}
          />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGuardar}
          disabled={guardando}
          style={{ width: '100%', justifyContent: 'center', minHeight: '44px' }}
        >
          {guardando ? <Loader2 size={16} className="animate-spin" /> : <BellPlus size={16} />} Crear recordatorio
        </button>
      </div>
    </div>,
    document.body
  )
}
