'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import UploadModal from '@/components/UploadModal'

export default function UploadModalWrapper({ scope, carpetaId }: { scope: 'comun' | 'publico' | 'privado', carpetaId?: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button className="btn btn-primary" onClick={() => setIsOpen(true)}>
        <Plus size={16} /> Subir Archivo
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
