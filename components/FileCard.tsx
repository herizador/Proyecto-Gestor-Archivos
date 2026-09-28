'use client'

import { FileText, Image, Download, Trash2, Eye, Link2 } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { visualizarArchivo, descargarArchivo, moverAPapelera } from '@/actions/files'
import { eliminarAcceso } from '@/actions/accesos'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DateDisplay from '@/components/DateDisplay'

export default function FileCard({
  file, isAdmin, isOwner, selected, onToggleSelect,
  esAcceso = false, origenNombre = null, huerfano = false,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  esAcceso?: boolean
  origenNombre?: string | null
  huerfano?: boolean
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
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
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
    if (esAcceso) {
      if (confirm('¿Eliminar este enlace? El archivo original no se toca.')) {
        setLoading(true)
        const result = await eliminarAcceso(file.id)
        setLoading(false)
        if (result.error) {
          alert(result.error)
        } else {
          router.refresh()
        }
      }
      return
    }
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="file-card-header" style={{ marginBottom: 0 }}>
            <div className={`file-card-icon-wrap ${isImage ? 'image-icon' : ''}`}>
              {isImage ? <Image size={24} /> : <FileText size={24} />}
            </div>
            <div className="file-card-details">
              <h3 className="file-card-name" title={file.nombre_original}>
                {file.nombre_original}
              </h3>
              {esAcceso && (
                <p style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>
                  <Link2 size={12} /> Enlace{huerfano ? ' · original no disponible' : ` de ${origenNombre ?? 'origen desconocido'}`}
                </p>
              )}
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
        <button className="btn btn-ghost btn-action" onClick={handleView} disabled={loading || huerfano} title={huerfano ? 'Original no disponible' : 'Visualizar archivo'}>
          <Eye size={16} /> <span>Visualizar</span>
        </button>
        <button className="btn btn-primary btn-action" onClick={handleDownload} disabled={loading || huerfano} title={huerfano ? 'Original no disponible' : 'Descargar archivo'}>
          <Download size={16} /> <span>Descargar</span>
        </button>
        {!esAcceso && (isAdmin || isOwner) && (
          <NuevoAccesoModal objetivoTipo="archivo" objetivoId={file.id} objetivoNombre={file.nombre_original} />
        )}
        {(isAdmin || isOwner) && (
          <button className="btn btn-danger btn-action btn-action-danger" onClick={handleTrash} disabled={loading} title={esAcceso ? 'Eliminar enlace (no toca el original)' : 'Mover a papelera'}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
