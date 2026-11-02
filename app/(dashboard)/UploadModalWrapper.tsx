'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import UploadModal from '@/components/UploadModal'

// Botón de subida reutilizable: mismo modal en el explorador, la caja fuerte
// y el hero de Inicio, con etiqueta y estilo configurables.
export default function UploadModalWrapper({
  scope,
  carpetaId,
  className = 'btn btn-primary',
  label = 'Subir Archivo',
  iconSize = 16,
}: {
  scope: 'comun' | 'publico' | 'privado'
  carpetaId?: string
  className?: string
  label?: string
  iconSize?: number
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button type="button" className={className} onClick={() => setIsOpen(true)}>
        <Plus size={iconSize} /> {label}
      </button>

      {isOpen && (
        <UploadModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          scope={scope}
          carpetaId={carpetaId}
        />
      )}
    </>
  )
}
