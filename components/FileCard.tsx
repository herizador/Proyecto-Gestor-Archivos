'use client'

import { FileText, Image, Download, Trash2, Eye } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { visualizarArchivo, descargarArchivo, moverAPapelera } from '@/actions/files'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DateDisplay from '@/components/DateDisplay'

export default function FileCard({
  file, isAdmin, isOwner, selected, onToggleSelect,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const isImage = file.tipo_mime.startsWith('image/')
  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleView() {
    setLoading(true)
    const { url, error } = await visualizarArchivo(file.id)
    setLoading(false)
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      alert(error || 'Enlace de visualización no válido.')
    }
  }

  async function handleDownload() {
    setLoading(true)
    const { url, nombreOriginal, error } = await descargarArchivo(file.id)
    setLoading(false)
    if (url) {
      const link = document.createElement('a')
      link.href = url
      link.download = nombreOriginal ?? file.nombre_original
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else {
      alert(error || 'Enlace de descarga no válido.')
    }
  }

  async function handleTrash() {
    if (confirm('¿Mover este archivo a la papelera?')) {
      setLoading(true)
      const result = await moverAPapelera(file.id)
      setLoading(false)
      if (result.error) {
        alert(result.error)
      } else {
        router.refresh()
      }
    }
  }

  return (
    <div className={`card card-hover file-card${selected ? ' card-selected' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        {onToggleSelect && (
          <div style={{ paddingTop: '4px' }}>
            <input
              type="checkbox"
              className="checkbox-input"
              checked={!!selected}
              onChange={() => onToggleSelect(file.id)}
              aria-label={`Seleccionar ${file.nombre_original}`}
            />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div className="file-card-header" style={{ marginBottom: 0 }}>
            <div className={`file-card-icon-wrap ${isImage ? 'image-icon' : ''}`}>
              {isImage ? <Image size={24} /> : <FileText size={24} />}
            </div>
            <div className="file-card-details">
              <h3 className="file-card-name" title={file.nombre_original}>
                {file.nombre_original}
              </h3>
              <p className="file-card-meta">
                {sizeKb} KB • <DateDisplay date={file.fecha_subida} />
              </p>
              <p className="file-card-author">
                Por: {file.subido_por_perfil?.nombre_completo || 'Desconocido'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="file-actions-group">
        <button className="btn btn-ghost btn-action" onClick={handleView} disabled={loading} title="Visualizar archivo">
          <Eye size={16} /> <span>Visualizar</span>
        </button>
        <button className="btn btn-primary btn-action" onClick={handleDownload} disabled={loading} title="Descargar archivo">
          <Download size={16} /> <span>Descargar</span>
        </button>
        {(isAdmin || isOwner) && (
          <button className="btn btn-danger btn-action btn-action-danger" onClick={handleTrash} disabled={loading} title="Mover a papelera">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
