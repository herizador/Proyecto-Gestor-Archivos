'use client'

import { useState } from 'react'
import { FolderPlus, X, Loader2 } from 'lucide-react'
import { crearCarpeta } from '@/actions/folders'
import { COLORES_CARPETA, COLOR_POR_DEFECTO, type ColorCarpeta } from '@/lib/colores-carpetas'
import { useRouter } from 'next/navigation'

export default function NewFolderModal({
  isOpen,
  onClose,
  carpetaPadreId = null,
  soloPrivada = false,
}: {
  isOpen: boolean
  onClose: () => void
  carpetaPadreId?: string | null
  soloPrivada?: boolean
}) {
  const [nombre, setNombre] = useState('')
  // En la caja fuerte las carpetas siempre son privadas (sin interruptor)
  const [esPrivada, setEsPrivada] = useState(soloPrivada)
  const [color, setColor] = useState<ColorCarpeta>(COLOR_POR_DEFECTO)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  if (!isOpen) return null

  async function handleCreate() {
    const trimmed = nombre.trim()
    if (!trimmed) {
      setError('Escribe un nombre para la carpeta.')
      return
    }

    setLoading(true)
    setError(null)

    const result = await crearCarpeta({
      nombre: trimmed,
      esPrivada,
      carpetaPadreId,
      color,
    })

    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setNombre('')
    setEsPrivada(soloPrivada)
    setColor(COLOR_POR_DEFECTO)
    onClose()
    router.refresh()
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Nueva Carpeta</h2>
          <button onClick={onClose} className="btn-ghost btn-icon" type="button">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="error-msg" style={{ marginBottom: '16px' }}>
            <span>{error}</span>
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label className="input-label" htmlFor="folderName">
            Nombre de la carpeta
          </label>
          <input
            id="folderName"
            type="text"
            className="input"
            placeholder="Ej. Documentos 2024"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={loading}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <span className="input-label">Color</span>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }} role="radiogroup" aria-label="Color de la carpeta">
            {COLORES_CARPETA.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                title={c.nombre}
                aria-label={`Color ${c.nombre}`}
                onClick={() => setColor(c.id)}
                disabled={loading}
                className={`punto-color pc-${c.id}${color === c.id ? ' activo' : ''}`}
                style={{ width: '36px', height: '36px' }}
              />
            ))}
          </div>
        </div>

        <div className="switch-row">
          <div>
            <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Carpeta privada</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              {soloPrivada
                ? 'En tu caja fuerte todas las carpetas son privadas'
                : 'Solo tú y el administrador podrán verla'}
            </p>
          </div>
          {!soloPrivada && (
            <label className="switch">
              <input
                type="checkbox"
                checked={esPrivada}
                onChange={(e) => setEsPrivada(e.target.checked)}
                disabled={loading}
              />
              <span className="switch-slider" />
            </label>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading} type="button">
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading} type="button">
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <FolderPlus size={16} /> Crear Carpeta
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
