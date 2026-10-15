'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, Image, Film, Music, Archive, Folder, FolderX, Eye, Download, Trash2, Link2, Pencil, Check, X, Star, UserPlus, BellPlus } from 'lucide-react'
import { visualizarArchivo, descargarArchivo, moverAPapelera, renombrarArchivo } from '@/actions/files'
import { renombrarCarpeta } from '@/actions/folders'
import { eliminarAcceso } from '@/actions/accesos'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import CompartirDialog from '@/components/CompartirDialog'
import RecordatorioModal from '@/components/RecordatorioModal'
import MenuAcciones, { type ItemMenu } from '@/components/MenuAcciones'
import { colorCarpetaDe } from '@/lib/colores-carpetas'
import { avisar, confirmar } from '@/components/Avisos'
import type { ArchivoConAutor, Carpeta } from '@/types/database'
import DateDisplay from '@/components/DateDisplay'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

const COLOR_TIPO: Record<string, string> = {
  image: '#34d399',
  pdf: '#f87171',
  video: '#a78bfa',
  audio: '#22d3ee',
  archive: '#fbbf24',
  doc: '#6ba3ff',
}

function kindDe(mime: string): string {
  const m = mime || ''
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.includes('zip') || m.includes('compressed') || m.includes('rar') || m.includes('7z')) return 'archive'
  return 'doc'
}

function IconoTipo({ kind }: { kind: string }) {
  const I = kind === 'image' ? Image : kind === 'video' ? Film : kind === 'audio' ? Music : kind === 'archive' ? Archive : FileText
  return <I size={18} />
}

// Fila compacta de archivo: misma API que FileCard para mapearla igual.
export function FilaArchivo({
  file, isAdmin, isOwner, selected, onToggleSelect,
  esAcceso = false, origenNombre = null, huerfano = false,
  esFavorito = false, onAlternarFavorito,
  ubicacion = null,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  esAcceso?: boolean
  origenNombre?: string | null
  huerfano?: boolean
  esFavorito?: boolean
  onAlternarFavorito?: () => void
  ubicacion?: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [editando, setEditando] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState(file.nombre_original)
  const [guardando, setGuardando] = useState(false)
  const [compartirAbierto, setCompartirAbierto] = useState(false)
  const [recordatorioAbierto, setRecordatorioAbierto] = useState(false)
  const enlaceRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const kind = kindDe(file.tipo_mime)
  const editable = (isAdmin || isOwner) && !esAcceso
  const puedeEnlazar = !esAcceso && (isAdmin || isOwner)
  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleView() {
    setLoading(true)
    const { url, error } = await visualizarArchivo(file.id)
    setLoading(false)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else avisar('error', error || 'Enlace de visualización no válido.')
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

  async function handleTrash() {
    const ok = await confirmar({
      titulo: esAcceso ? 'Eliminar enlace' : 'Mover a papelera',
      mensaje: esAcceso ? '¿Eliminar este enlace? El archivo original no se toca.' : '¿Mover este archivo a la papelera?',
      textoOk: esAcceso ? 'Eliminar' : 'Mover',
      peligroso: true,
    })
    if (!ok) return
    setLoading(true)
    const result = esAcceso ? await eliminarAcceso(file.id) : await moverAPapelera(file.id)
    setLoading(false)
    if (result.error) avisar('error', result.error)
    else {
      avisar('exito', esAcceso ? 'Enlace eliminado.' : 'Movido a la papelera.')
      router.refresh()
    }
  }

  const itemsMenu: ItemMenu[] = [
    { icono: <Eye size={16} />, texto: 'Visualizar', onClick: handleView, deshabilitado: loading || huerfano },
    { icono: <Download size={16} />, texto: 'Descargar', onClick: handleDownload, deshabilitado: loading || huerfano },
    ...(!esAcceso && onAlternarFavorito
      ? [{
          icono: <Star size={16} fill={esFavorito ? 'currentColor' : 'none'} />,
          texto: esFavorito ? 'Quitar de favoritos' : 'Añadir a favoritos',
          onClick: onAlternarFavorito,
          deshabilitado: loading,
        }]
      : []),
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
      ? [{ icono: <Link2 size={16} />, texto: 'Crear enlace', onClick: () => enlaceRef.current?.querySelector('button')?.click(), deshabilitado: loading }]
      : []),
    ...(puedeEnlazar
      ? [{
          icono: <UserPlus size={16} />,
          texto: 'Compartir',
          onClick: () => setCompartirAbierto(true),
          deshabilitado: loading,
        }]
      : []),
    ...(puedeEnlazar
      ? [{
          icono: <BellPlus size={16} />,
          texto: 'Crear recordatorio',
          onClick: () => setRecordatorioAbierto(true),
          deshabilitado: loading,
        }]
      : []),
    ...((isAdmin || isOwner)
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
    <div className={`fila-lista${selected ? ' card-selected' : ''}`}>
      {onToggleSelect && (
        <input
          type="checkbox"
          className="checkbox-input"
          checked={!!selected}
          onChange={() => onToggleSelect(file.id)}
          aria-label={`Seleccionar ${file.nombre_original}`}
          style={{ flexShrink: 0 }}
        />
      )}
      <div className="file-card-icon-wrap" style={{ padding: '9px', color: COLOR_TIPO[kind], flexShrink: 0 }}>
        <IconoTipo kind={kind} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editando ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
            <button type="button" className="btn-ghost btn-icon" onClick={handleGuardarNombre} disabled={guardando} aria-label="Guardar nombre" style={{ padding: '6px', flexShrink: 0 }}>
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
              aria-label="Cancelar"
              style={{ padding: '6px', flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </span>
        ) : (
          <p className="file-card-name" title={file.nombre_original}>
            {file.nombre_original}
          </p>
        )}
        <p className="file-card-meta">
          {sizeKb} KB • <DateDisplay date={file.fecha_subida} />
          {esAcceso && (huerfano ? ' • Enlace no disponible' : ` • Enlace de ${origenNombre ?? 'origen desconocido'}`)}
          {ubicacion && ` • En ${ubicacion}`}
        </p>
      </div>
      <div style={{ flexShrink: 0 }}>
        <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${file.nombre_original}`} />
      </div>
      {puedeEnlazar && (
        <div ref={enlaceRef} style={{ display: 'none' }} aria-hidden="true">
          <NuevoAccesoModal objetivoTipo="archivo" objetivoId={file.id} objetivoNombre={file.nombre_original} />
        </div>
      )}
      {puedeEnlazar && (
        <CompartirDialog
          tipo="archivo"
          id={file.id}
          nombre={file.nombre_original}
          abierto={compartirAbierto}
          alCerrar={() => setCompartirAbierto(false)}
        />
      )}
      {puedeEnlazar && (
        <RecordatorioModal
          abierto={recordatorioAbierto}
          alCerrar={() => setRecordatorioAbierto(false)}
          preset={{ tipo: 'archivo', id: file.id, nombre: file.nombre_original }}
        />
      )}
    </div>
  )
}

// Fila compacta de carpeta: misma API que FolderCard para mapearla igual.
export function FilaCarpeta({
  carpeta, selected, onToggleSelect, basePath = '/',
  esAcceso = false, accesoId = null, origenNombre = null, huerfano = false,
  onEliminarAcceso, crearEnlace = null, puedeRenombrar = false,
  esFavorito = false, onAlternarFavorito,
}: {
  carpeta: CarpetaConAutor
  selected?: boolean
  onToggleSelect?: (id: string) => void
  basePath?: string
  esAcceso?: boolean
  accesoId?: string | null
  origenNombre?: string | null
  huerfano?: boolean
  onEliminarAcceso?: (accesoId: string) => void
  crearEnlace?: React.ReactNode
  puedeRenombrar?: boolean
  esFavorito?: boolean
  onAlternarFavorito?: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState(carpeta.nombre)
  const [guardando, setGuardando] = useState(false)
  const [compartirAbierto, setCompartirAbierto] = useState(false)
  const [recordatorioAbierto, setRecordatorioAbierto] = useState(false)
  const enlaceRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const editable = puedeRenombrar && !esAcceso
  const hayMenu = editable || !!crearEnlace || !!(esAcceso && onEliminarAcceso && accesoId)

  async function guardarNombre() {
    const limpio = nuevoNombre.trim()
    if (!limpio || limpio === carpeta.nombre) {
      setNuevoNombre(carpeta.nombre)
      setEditando(false)
      return
    }
    if (limpio.length > 100) {
      avisar('error', 'Máximo 100 caracteres.')
      return
    }
    setGuardando(true)
    const res = await renombrarCarpeta(carpeta.id, limpio)
    setGuardando(false)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    setEditando(false)
    router.refresh()
  }

  async function handleEliminar() {
    if (!accesoId) return
    const ok = await confirmar({
      titulo: 'Eliminar enlace',
      mensaje: '¿Eliminar este enlace? La carpeta original no se toca.',
      textoOk: 'Eliminar',
      peligroso: true,
    })
    if (!ok) return
    onEliminarAcceso?.(accesoId)
  }

  const itemsMenu: ItemMenu[] = [
    ...(editable
      ? [{
          icono: <Pencil size={16} />,
          texto: 'Renombrar',
          onClick: () => {
            setNuevoNombre(carpeta.nombre)
            setEditando(true)
          },
        }]
      : []),
    ...(crearEnlace
      ? [{ icono: <Link2 size={16} />, texto: 'Crear enlace', onClick: () => enlaceRef.current?.querySelector('button')?.click() }]
      : []),
    ...(editable
      ? [{
          icono: <UserPlus size={16} />,
          texto: 'Compartir',
          onClick: () => setCompartirAbierto(true),
        }]
      : []),
    ...(editable
      ? [{
          icono: <BellPlus size={16} />,
          texto: 'Crear recordatorio',
          onClick: () => setRecordatorioAbierto(true),
        }]
      : []),
    ...(!esAcceso && onAlternarFavorito
      ? [{
          icono: <Star size={16} fill={esFavorito ? 'currentColor' : 'none'} />,
          texto: esFavorito ? 'Quitar de favoritos' : 'Añadir a favoritos',
          onClick: onAlternarFavorito,
        }]
      : []),
    ...(esAcceso && onEliminarAcceso && accesoId
      ? [{ icono: <Trash2 size={16} />, texto: 'Eliminar enlace', peligroso: true, onClick: () => handleEliminar() }]
      : []),
  ]

  return (
    <div className={`fila-lista${selected ? ' card-selected' : ''}`}>
      {onToggleSelect && (
        <input
          type="checkbox"
          className="checkbox-input"
          checked={!!selected}
          onChange={() => onToggleSelect(carpeta.id)}
          aria-label={`Seleccionar carpeta ${carpeta.nombre}`}
          style={{ flexShrink: 0 }}
        />
      )}
      <div className={`folder-card-icon fc-${colorCarpetaDe(carpeta)}`} style={{ padding: '9px', marginBottom: 0, flexShrink: 0 }}>
        {huerfano ? <FolderX size={18} /> : <Folder size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editando ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="text"
              className="input"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') guardarNombre()
                if (e.key === 'Escape') {
                  setNuevoNombre(carpeta.nombre)
                  setEditando(false)
                }
              }}
              maxLength={100}
              autoFocus
              disabled={guardando}
              aria-label="Nuevo nombre de la carpeta"
              style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', padding: '6px 10px' }}
            />
            <button type="button" className="btn-ghost btn-icon" onClick={() => guardarNombre()} disabled={guardando} aria-label="Guardar nombre" style={{ padding: '6px', flexShrink: 0 }}>
              <Check size={14} />
            </button>
            <button
              type="button"
              className="btn-ghost btn-icon"
              onClick={() => {
                setNuevoNombre(carpeta.nombre)
                setEditando(false)
              }}
              disabled={guardando}
              aria-label="Cancelar"
              style={{ padding: '6px', flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </span>
        ) : huerfano ? (
          <p className="file-card-name" title={carpeta.nombre}>
            {carpeta.nombre}
          </p>
        ) : (
          <Link href={`${basePath}?carpeta=${carpeta.id}`} className="file-card-name" title={carpeta.nombre} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            {carpeta.nombre}
          </Link>
        )}
        <p className="file-card-meta">
          <DateDisplay date={carpeta.fecha_creacion} />
          {esAcceso && (huerfano ? ' • Enlace no disponible' : ` • Enlace de ${origenNombre ?? 'origen desconocido'}`)}
        </p>
      </div>
      {hayMenu && (
        <div style={{ flexShrink: 0 }}>
          <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${carpeta.nombre}`} />
        </div>
      )}
      {crearEnlace && (
        <div ref={enlaceRef} style={{ display: 'none' }} aria-hidden="true">
          {crearEnlace}
        </div>
      )}
      {editable && (
        <CompartirDialog
          tipo="carpeta"
          id={carpeta.id}
          nombre={carpeta.nombre}
          abierto={compartirAbierto}
          alCerrar={() => setCompartirAbierto(false)}
        />
      )}
      {editable && (
        <RecordatorioModal
          abierto={recordatorioAbierto}
          alCerrar={() => setRecordatorioAbierto(false)}
          preset={{ tipo: 'carpeta', id: carpeta.id, nombre: carpeta.nombre }}
        />
      )}
    </div>
  )
}
