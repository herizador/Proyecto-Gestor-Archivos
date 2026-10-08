'use client'

import { FileText, Image, Download, Trash2, Eye, Link2, Pencil, Check, X, Film, Music, Archive } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { visualizarArchivo, descargarArchivo, moverAPapelera, renombrarArchivo } from '@/actions/files'
import { eliminarAcceso } from '@/actions/accesos'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import MenuAcciones, { type ItemMenu } from '@/components/MenuAcciones'
import { avisar, confirmar } from '@/components/Avisos'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
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
  const [editando, setEditando] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState(file.nombre_original)
  const [guardando, setGuardando] = useState(false)
  const enlaceRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Renombrar solo en originales: el enlace sigue al original automáticamente
  const editable = (isAdmin || isOwner) && !esAcceso

  async function handleGuardarNombre() {
    const limpio = nuevoNombre.trim()
    if (!limpio || limpio === file.nombre_original) {
      setNuevoNombre(file.nombre_original)
      setEditando(false)
      return
    }
    if (limpio.length > 200) {
      avisar('error', 'Máximo 200 caracteres.')
      return
    }
    setGuardando(true)
    const res = await renombrarArchivo(file.id, limpio)
    setGuardando(false)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    setEditando(false)
    router.refresh()
  }

  const kindArchivo = (() => {
    const mime = file.tipo_mime || ''
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf') return 'pdf'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('rar') || mime.includes('7z')) return 'archive'
    return 'doc'
  })()
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
      avisar('error', error || 'Enlace de visualización no válido.')
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
      avisar('error', error || 'Enlace de descarga no válido.')
    }
  }

  async function handleTrash() {
    if (esAcceso) {
      const ok = await confirmar({
        titulo: 'Eliminar enlace',
        mensaje: '¿Eliminar este enlace? El archivo original no se toca.',
        textoOk: 'Eliminar',
        peligroso: true,
      })
      if (!ok) return
      setLoading(true)
      const result = await eliminarAcceso(file.id)
      setLoading(false)
      if (result.error) {
        avisar('error', result.error)
      } else {
        avisar('exito', 'Enlace eliminado.')
        router.refresh()
      }
      return
    }
    const ok = await confirmar({
      titulo: 'Mover a papelera',
      mensaje: '¿Mover este archivo a la papelera?',
      textoOk: 'Mover',
      peligroso: true,
    })
    if (!ok) return
    setLoading(true)
    const result = await moverAPapelera(file.id)
    setLoading(false)
    if (result.error) {
      avisar('error', result.error)
    } else {
      avisar('exito', 'Movido a la papelera.')
      router.refresh()
    }
  }

  // Dispara el botón oculto de NuevoAccesoModal (su modal ya vive en un portal)
  function dispararEnlace() {
    enlaceRef.current?.querySelector('button')?.click()
  }

  const puedeEnlazar = !esAcceso && (isAdmin || isOwner)
  const puedeBorrar = isAdmin || isOwner

  const itemsMenu: ItemMenu[] = [
    { icono: <Eye size={16} />, texto: 'Visualizar', onClick: handleView, deshabilitado: loading || huerfano },
    { icono: <Download size={16} />, texto: 'Descargar', onClick: handleDownload, deshabilitado: loading || huerfano },
    ...(editable
      ? [{
          icono: <Pencil size={16} />,
          texto: 'Renombrar',
          onClick: () => {
            setNuevoNombre(file.nombre_original)
            setEditando(true)
          },
          deshabilitado: loading,
        }]
      : []),
    ...(puedeEnlazar
      ? [{ icono: <Link2 size={16} />, texto: 'Crear enlace', onClick: dispararEnlace, deshabilitado: loading }]
      : []),
    ...(puedeBorrar
      ? [{
          icono: <Trash2 size={16} />,
          texto: esAcceso ? 'Eliminar enlace' : 'Mover a papelera',
          peligroso: true,
          onClick: handleTrash,
          deshabilitado: loading,
        }]
      : []),
  ]

  return (
    <div className={`card card-hover file-card${selected ? ' card-selected' : ''}`} style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 5 }}>
        <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${file.nombre_original}`} />
      </div>
      {puedeEnlazar && (
        <div ref={enlaceRef} style={{ display: 'none' }} aria-hidden="true">
          <NuevoAccesoModal objetivoTipo="archivo" objetivoId={file.id} objetivoNombre={file.nombre_original} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', paddingRight: '40px' }}>
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
            <div className={`file-card-icon-wrap ft-${kindArchivo}`}>
              {kindArchivo === 'image' ? <Image size={24} />
                : kindArchivo === 'video' ? <Film size={24} />
                : kindArchivo === 'audio' ? <Music size={24} />
                : kindArchivo === 'archive' ? <Archive size={24} />
                : <FileText size={24} />}
            </div>
            <div className="file-card-details">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                {editando ? (
                  <>
                    <input
                      type="text"
                      className="input"
                      value={nuevoNombre}
                      onChange={(e) => setNuevoNombre(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleGuardarNombre()
                        if (e.key === 'Escape') {
                          setNuevoNombre(file.nombre_original)
                          setEditando(false)
                        }
                      }}
                      maxLength={200}
                      autoFocus
                      disabled={guardando}
                      aria-label="Nuevo nombre del archivo"
                      style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', padding: '6px 10px' }}
                    />
                    <button
                      type="button"
                      className="btn-ghost btn-icon"
                      onClick={handleGuardarNombre}
                      disabled={guardando}
                      title="Guardar nombre"
                      aria-label="Guardar nombre"
                      style={{ padding: '6px', flexShrink: 0 }}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-icon"
                      onClick={() => {
                        setNuevoNombre(file.nombre_original)
                        setEditando(false)
                      }}
                      disabled={guardando}
                      title="Cancelar"
                      aria-label="Cancelar"
                      style={{ padding: '6px', flexShrink: 0 }}
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <h3 className="file-card-name" title={file.nombre_original} style={{ flex: 1, minWidth: 0 }}>
                    {file.nombre_original}
                  </h3>
                )}
              </div>
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
    </div>
  )
}
