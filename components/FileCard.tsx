'use client'

import { FileText, Image, Download, Trash2, RefreshCw } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { descargarArchivo, moverAPapelera, restaurarArchivo } from '@/actions/files'
import { useState } from 'react'

export default function FileCard({ file, isAdmin, isOwner }: { file: ArchivoConAutor, isAdmin: boolean, isOwner: boolean }) {
  const [loading, setLoading] = useState(false)

  const isImage = file.tipo_mime.startsWith('image/')
  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleDownload() {
    setLoading(true)
    const { url, error } = await descargarArchivo(file.id)
    setLoading(false)
    if (url) {
      window.open(url, '_blank')
    } else {
      alert(error || 'Error al descargar')
    }
  }

  async function handleTrash() {
    if (confirm('¿Mover este archivo a la papelera?')) {
      setLoading(true)
      await moverAPapelera(file.id)
      setLoading(false)
    }
  }

  async function handleRestore() {
    setLoading(true)
    await restaurarArchivo(file.id)
    setLoading(false)
  }

  return (
    <div className="card card-hover" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)' }}>
          {isImage ? <Image size={24} /> : <FileText size={24} />}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {file.nombre_original}
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {sizeKb} KB • {new Date(file.fecha_subida).toLocaleDateString()}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '2px' }}>
            Por: {file.subido_por_perfil?.nombre_completo || 'Desconocido'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
        {file.estado === 'activo' ? (
          <>
            <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={handleDownload} disabled={loading}>
              <Download size={14} /> Descargar
            </button>
            {(isAdmin || isOwner) && (
              <button className="btn btn-danger btn-icon" onClick={handleTrash} disabled={loading} title="Mover a papelera">
                <Trash2 size={14} />
              </button>
            )}
          </>
        ) : (
          <>
             <span className="badge badge-papelera" style={{ flex: 1, justifyContent: 'center' }}>En Papelera</span>
             {(isAdmin || isOwner) && (
              <button className="btn btn-ghost btn-icon" onClick={handleRestore} disabled={loading} title="Restaurar">
                <RefreshCw size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
