'use client'

import { FileText, Image, Download, Trash2, Eye, Link2, Share2, Copy, Check } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { visualizarArchivo, descargarArchivo, enviarArchivo, moverAPapelera } from '@/actions/files'
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
  const [copiado, setCopiado] = useState(false)
  const router = useRouter()

  // Navegador con Web Share (los tipos lib.dom pueden no traerlo: interfaz mínima)
  type NavigatorConShare = Navigator & {
    share?: (datos: { files?: File[]; title?: string; text?: string }) => Promise<void>
    canShare?: (datos: { files: File[] }) => boolean
  }

  async function blobParaEnviar(): Promise<{ blob: Blob; nombre: string; tipo: string } | null> {
    const res = await enviarArchivo(file.id)
    if (!('url' in res) || !res.url) {
      alert(('error' in res && res.error) || 'No se pudo preparar el archivo.')
      return null
    }
    const r = await fetch(res.url, { credentials: 'omit' })
    if (!r.ok) {
      alert('No se pudo obtener el archivo.')
      return null
    }
    const blob = await r.blob()
    return { blob, nombre: res.nombreOriginal ?? file.nombre_original, tipo: res.tipoMime || file.tipo_mime }
  }

  // Enviar a otra app (WhatsApp, correo…) sin guardarlo en el dispositivo.
  // Si el navegador no soporta compartir archivos, cae a la descarga clásica.
  async function handleEnviar() {
    const nav = navigator as NavigatorConShare
    if (!nav.share) {
      await handleDownload()
      return
    }
    setLoading(true)
    try {
      const datos = await blobParaEnviar()
      if (!datos) return
      const fichero = new File([datos.blob], datos.nombre, { type: datos.tipo })
      if (nav.canShare && !nav.canShare({ files: [fichero] })) {
        await handleDownload()
        return
      }
      await nav.share({ files: [fichero], title: datos.nombre })
    } catch (e) {
      // AbortError = el usuario cerró el menú: silencio. Otro fallo: descarga.
      if (e instanceof DOMException && e.name === 'AbortError') return
      await handleDownload()
    } finally {
      setLoading(false)
    }
  }

  // Copiar para pegar (Ctrl+V) en Gmail, Drive web, WhatsApp Web, etc.
  async function handleCopiar() {
    if (!navigator.clipboard || !('write' in navigator.clipboard) || typeof ClipboardItem === 'undefined') {
      alert('Este navegador no permite copiar archivos. Usa Enviar o Descargar.')
      return
    }
    setLoading(true)
    try {
      const datos = await blobParaEnviar()
      if (!datos) return
      const tipo = datos.blob.type || datos.tipo || 'application/octet-stream'
      await navigator.clipboard.write([new ClipboardItem({ [tipo]: datos.blob })])
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      alert('No se pudo copiar. Usa Enviar o Descargar.')
    } finally {
      setLoading(false)
    }
  }

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
        <button className="btn btn-ghost btn-action" onClick={handleEnviar} disabled={loading || huerfano} title={huerfano ? 'Original no disponible' : 'Enviar a otra app sin guardarlo (o descargar si el navegador no lo permite)'}>
          <Share2 size={16} /> <span>Enviar</span>
        </button>
        {!esAcceso && (isAdmin || isOwner) && (
          <NuevoAccesoModal objetivoTipo="archivo" objetivoId={file.id} objetivoNombre={file.nombre_original} />
        )}
        <button className="btn btn-ghost btn-action" onClick={handleCopiar} disabled={loading || huerfano} title={huerfano ? 'Original no disponible' : 'Copiar para pegar en otra página o app'}>
          {copiado ? <Check size={16} /> : <Copy size={16} />} <span>{copiado ? '¡Copiado!' : 'Copiar'}</span>
        </button>
        {(isAdmin || isOwner) && (
          <button className="btn btn-danger btn-action btn-action-danger" onClick={handleTrash} disabled={loading} title={esAcceso ? 'Eliminar enlace (no toca el original)' : 'Mover a papelera'}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
