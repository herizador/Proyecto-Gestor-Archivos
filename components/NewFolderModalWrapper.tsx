'use client'

import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import NewFolderModal from '@/components/NewFolderModal'

export default function NewFolderModalWrapper({
  carpetaPadreId = null,
}: {
  carpetaPadreId?: string | null
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setIsOpen(true)} type="button">
        <FolderPlus size={16} /> Nueva Carpeta
      </button>

      {isOpen && (
        <NewFolderModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          carpetaPadreId={carpetaPadreId}
        />
      )}
    </>
  )
}
