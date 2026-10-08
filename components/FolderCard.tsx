'use client'

import { useRef, useState } from 'react'
import { Folder, Link2, Trash2, FolderX, Pencil, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { renombrarCarpeta } from '@/actions/folders'
import MenuAcciones, { type ItemMenu } from '@/components/MenuAcciones'
import type { Carpeta } from '@/types/database'
import DateDisplay from '@/components/DateDisplay'
import type { ReactNode } from 'react'
import { avisar, confirmar } from '@/components/Avisos'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

export default function FolderCard({
  carpeta,
  selected,
  onToggleSelect,
  basePath = '/',
  esAcceso = false,
  accesoId = null,
  origenNombre = null,
  huerfano = false,
  onEliminarAcceso,
  crearEnlace = null,
  puedeRenombrar = false,
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
  crearEnlace?: ReactNode
  puedeRenombrar?: boolean
}) {
  const folderHref = `${basePath}?carpeta=${carpeta.id}`
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState(carpeta.nombre)
  const [guardando, setGuardando] = useState(false)
  const enlaceRef = useRef<HTMLDivElement>(null)

  // Renombrar solo en originales: el enlace sigue al original automáticamente
  const editable = puedeRenombrar && !esAcceso

  async function guardarNombre(e?: React.SyntheticEvent) {
    e?.preventDefault()
    e?.stopPropagation()
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

  async function handleEliminar(e?: React.SyntheticEvent) {
    e?.preventDefault()
    e?.stopPropagation()
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

  // Dispara el botón oculto del modal de enlace (su modal ya vive en un portal)
  function dispararEnlace() {
    enlaceRef.current?.querySelector('button')?.click()
  }

  const hayMenu = editable || !!crearEnlace || !!(esAcceso && onEliminarAcceso && accesoId)

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
      ? [{ icono: <Link2 size={16} />, texto: 'Crear enlace', onClick: dispararEnlace }]
      : []),
    ...(esAcceso && onEliminarAcceso && accesoId
      ? [{
          icono: <Trash2 size={16} />,
          texto: 'Eliminar enlace',
          peligroso: true,
          onClick: () => handleEliminar(),
        }]
      : []),
  ]

  const contenido = (
    <>
      <div className="folder-card-icon">
        {huerfano ? <FolderX size={28} /> : <Folder size={28} />}
      </div>
      {editando ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', minWidth: 0 }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <input
            type="text"
            className="input"
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            onClick={(e) => e.stopPropagation()}
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
            style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', padding: '6px 10px', textAlign: 'center' }}
          />
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={guardarNombre}
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
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setNuevoNombre(carpeta.nombre)
              setEditando(false)
            }}
            disabled={guardando}
            title="Cancelar"
            aria-label="Cancelar"
            style={{ padding: '6px', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <h3 className="folder-card-name" title={carpeta.nombre}>
          {carpeta.nombre}
        </h3>
      )}
      {esAcceso && (
        <p style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>
          <Link2 size={12} /> Enlace{huerfano ? ' · no disponible' : ` de ${origenNombre ?? 'origen desconocido'}`}
        </p>
      )}
      <p className="folder-card-meta">
        <DateDisplay date={carpeta.fecha_creacion} />
      </p>
    </>
  )

  return (
    <div className={`card card-hover folder-card${selected ? ' card-selected' : ''}`}>
      {onToggleSelect && (
        <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 10 }}>
          <input
            type="checkbox"
            className="checkbox-input"
            checked={!!selected}
            onChange={() => onToggleSelect(carpeta.id)}
            aria-label={`Seleccionar carpeta ${carpeta.nombre}`}
          />
        </div>
      )}
      {hayMenu && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }}>
          <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${carpeta.nombre}`} />
        </div>
      )}
      {crearEnlace && (
        <div ref={enlaceRef} style={{ display: 'none' }} aria-hidden="true">
          {crearEnlace}
        </div>
      )}
      {huerfano ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '20px 16px', width: '100%', opacity: 0.6 }}>
          {contenido}
        </div>
      ) : (
        <Link href={folderHref} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '20px 16px', textDecoration: 'none', color: 'inherit', width: '100%' }}>
          {contenido}
        </Link>
      )}
    </div>
  )
}
