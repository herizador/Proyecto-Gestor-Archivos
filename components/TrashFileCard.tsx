'use client'

import { FileText, Image, RefreshCw, Trash2, Film, Music, Archive } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { restaurarArchivo, eliminarArchivoPermanente } from '@/actions/files'
import MenuAcciones, { type ItemMenu } from '@/components/MenuAcciones'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DateDisplay from '@/components/DateDisplay'
import { avisar, confirmar } from '@/components/Avisos'

export default function TrashFileCard({
  file,
  isAdmin,
  isOwner,
  seleccionable = false,
  seleccionado = false,
  onToggle,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
  seleccionable?: boolean
  seleccionado?: boolean
  onToggle?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const kindArchivo = (() => {
    const mime = file.tipo_mime || ''
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf') return 'pdf'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('rar') || mime.includes('7z')) return 'archive'
    return 'doc'
  })()
  const extension = (() => {
    const i = file.nombre_original.lastIndexOf('.')
    if (i > 0 && file.nombre_original.length - i <= 6) return file.nombre_original.slice(i + 1).toUpperCase()
    return (file.tipo_mime.split('/')[1] ?? 'FILE').toUpperCase().slice(0, 4)
  })()
  const IconoTipo = kindArchivo === 'image' ? Image
    : kindArchivo === 'video' ? Film
    : kindArchivo === 'audio' ? Music
    : kindArchivo === 'archive' ? Archive
    : FileText

  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleRestore() {
    setLoading(true)
    const result = await restaurarArchivo(file.id)
    setLoading(false)
    if (result.error) {
      avisar('error', result.error)
    } else {
      avisar('exito', 'Archivo restaurado.')
      router.refresh()
    }
  }

  async function handlePermanentDelete() {
    const ok = await confirmar({
      titulo: 'Eliminar para siempre',
      mensaje: '¿Eliminar permanentemente este archivo? Esta acción no se puede deshacer.',
      textoOk: 'Eliminar',
      peligroso: true,
    })
    if (!ok) return

    setLoading(true)
    const result = await eliminarArchivoPermanente(file.id)
    setLoading(false)
    if (result.error) {
      avisar('error', result.error)
    } else {
      avisar('exito', 'Archivo eliminado permanentemente.')
      router.refresh()
    }
  }

  const canManage = isAdmin || isOwner
  const puedeSeleccionar = seleccionable && canManage

  const itemsMenu: ItemMenu[] = [
    { icono: <RefreshCw size={16} />, texto: 'Restaurar', onClick: handleRestore, deshabilitado: loading },
    ...(canManage
      ? [{
          icono: <Trash2 size={16} />,
          texto: 'Eliminar permanentemente',
          peligroso: true,
          onClick: handlePermanentDelete,
          deshabilitado: loading,
        }]
      : []),
  ]

  return (
    <div
      className={`card card-hover${seleccionado ? ' card-selected' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        position: 'relative',
        cursor: puedeSeleccionar ? 'pointer' : undefined,
      }}
      onClick={puedeSeleccionar ? onToggle : undefined}
    >
      {puedeSeleccionar && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            zIndex: 6,
            display: 'flex',
            padding: '4px',
            borderRadius: '8px',
            background: 'rgba(13, 18, 32, 0.9)',
            border: '1px solid var(--color-border-hover)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="checkbox-input"
            checked={seleccionado}
            onChange={onToggle}
            aria-label={`Seleccionar ${file.nombre_original}`}
          />
        </div>
      )}
      {canManage && !seleccionable && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 5 }}>
          <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${file.nombre_original}`} />
        </div>
      )}
      <div className={`file-preview fp-${kindArchivo}`}>
        <IconoTipo size={30} />
        <span className="file-ext">{extension}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', paddingRight: canManage && !seleccionable ? '40px' : 0 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {file.nombre_original}
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {sizeKb} KB • Eliminado {file.fecha_papelera ? <DateDisplay date={file.fecha_papelera} /> : '—'}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '2px' }}>
            Por: {file.subido_por_perfil?.nombre_completo || 'Desconocido'}
          </p>
          {!canManage && (
            <span className="badge badge-papelera" style={{ marginTop: '8px' }}>
              En Papelera
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
