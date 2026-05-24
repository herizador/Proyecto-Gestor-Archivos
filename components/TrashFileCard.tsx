'use client'

import { FileText, Image, RefreshCw, Trash2 } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { restaurarArchivo, eliminarArchivoPermanente } from '@/actions/files'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function TrashFileCard({
  file,
  isAdmin,
  isOwner,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const isImage = file.tipo_mime.startsWith('image/')
  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleRestore() {
    setLoading(true)
    const result = await restaurarArchivo(file.id)
    setLoading(false)
    if (result.error) {
      alert(result.error)
    } else {
      router.refresh()
    }
  }

  async function handlePermanentDelete() {
    if (!confirm('¿Eliminar permanentemente este archivo? Esta acción no se puede deshacer.')) return

    setLoading(true)
    const result = await eliminarArchivoPermanente(file.id)
    setLoading(false)
    if (result.error) {
      alert(result.error)
    } else {
      router.refresh()
    }
  }

  const canManage = isAdmin || isOwner

  return (
    <div className="card card-hover" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)' }}>
          {isImage ? <Image size={24} /> : <FileText size={24} />}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {file.nombre_original}
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {sizeKb} KB • Eliminado {file.fecha_papelera ? new Date(file.fecha_papelera).toLocaleDateString() : '—'}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '2px' }}>
            Por: {file.subido_por_perfil?.nombre_completo || 'Desconocido'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
        {canManage ? (
          <>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={handleRestore}
              disabled={loading}
            >
              <RefreshCw size={14} /> Restaurar
            </button>
            {isAdmin && (
              <button
                className="btn btn-danger btn-sm"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={handlePermanentDelete}
                disabled={loading}
              >
                <Trash2 size={14} /> Eliminar permanentemente
              </button>
            )}
          </>
        ) : (
          <span className="badge badge-papelera" style={{ flex: 1, justifyContent: 'center' }}>
            En Papelera
          </span>
        )}
      </div>
    </div>
  )
}
