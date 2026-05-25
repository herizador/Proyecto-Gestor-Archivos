'use client'

import { useState } from 'react'
import { FolderPlus, X, Loader2 } from 'lucide-react'
import { crearCarpeta } from '@/actions/folders'
import { useRouter } from 'next/navigation'

export default function NewFolderModal({
  isOpen,
  onClose,
  carpetaPadreId = null,
}: {
  isOpen: boolean
  onClose: () => void
  carpetaPadreId?: string | null
}) {
  const [nombre, setNombre] = useState('')
  const [esPrivada, setEsPrivada] = useState(false)
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
    })

    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setNombre('')
    setEsPrivada(false)
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

        <div className="switch-row">
          <div>
            <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Carpeta privada</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Solo tú y el administrador podrán verla
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={esPrivada}
              onChange={(e) => setEsPrivada(e.target.checked)}
              disabled={loading}
            />
            <span className="switch-slider" />
          </label>
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
