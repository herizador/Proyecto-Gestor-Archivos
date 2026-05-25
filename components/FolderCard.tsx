'use client'

import { Folder } from 'lucide-react'
import Link from 'next/link'
import type { Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

export default function FolderCard({ carpeta }: { carpeta: CarpetaConAutor }) {
  return (
    <Link href={`/?carpeta=${carpeta.id}`} className="card card-hover folder-card">
      <div className="folder-card-icon">
        <Folder size={28} />
      </div>
      <h3 className="folder-card-name">{carpeta.nombre}</h3>
      <p className="folder-card-meta">
        {new Date(carpeta.fecha_creacion).toLocaleDateString()}
      </p>
    </Link>
  )
}
