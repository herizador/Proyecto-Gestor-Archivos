'use client'

import { Folder } from 'lucide-react'
import Link from 'next/link'
import type { Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

export default function FolderCard({
  carpeta,
  selected,
  onToggleSelect,
  carpetaActualId,
}: {
  carpeta: CarpetaConAutor
  selected?: boolean
  onToggleSelect?: (id: string) => void
  carpetaActualId?: string | null
}) {
  const folderHref = carpetaActualId
    ? `/?carpeta=${carpeta.id}`
    : `/?carpeta=${carpeta.id}`

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
      <Link href={folderHref} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '20px 16px', textDecoration: 'none', color: 'inherit', width: '100%' }}>
        <div className="folder-card-icon">
          <Folder size={28} />
        </div>
        <h3 className="folder-card-name">{carpeta.nombre}</h3>
        <p className="folder-card-meta">
          {new Date(carpeta.fecha_creacion).toLocaleDateString()}
        </p>
      </Link>
    </div>
  )
}
