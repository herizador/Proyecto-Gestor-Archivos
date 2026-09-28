'use client'

import { Folder, Link2, Trash2, FolderX } from 'lucide-react'
import Link from 'next/link'
import type { Carpeta } from '@/types/database'
import DateDisplay from '@/components/DateDisplay'
import type { ReactNode } from 'react'

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
}) {
  const folderHref = `${basePath}?carpeta=${carpeta.id}`

  async function handleEliminar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!accesoId) return
    if (confirm('¿Eliminar este enlace? La carpeta original no se toca.')) {
      onEliminarAcceso?.(accesoId)
    }
  }

  const contenido = (
    <>
      <div className="folder-card-icon">
        {huerfano ? <FolderX size={28} /> : <Folder size={28} />}
      </div>
      <h3 className="folder-card-name">{carpeta.nombre}</h3>
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
      {esAcceso && onEliminarAcceso && accesoId && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }}>
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={handleEliminar}
            title="Eliminar enlace (no toca el original)"
            aria-label={`Eliminar enlace ${carpeta.nombre}`}
          >
            <Trash2 size={16} />
          </button>
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
      {crearEnlace && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 12px 12px' }}>
          {crearEnlace}
        </div>
      )}
    </div>
  )
}
