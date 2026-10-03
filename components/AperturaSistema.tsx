'use client'

import { useEffect, useState } from 'react'
import GuardadoManual from '@/components/GuardadoManual'
import type { Carpeta } from '@/types/database'

declare global {
  interface Window {
    launchQueue?: {
      setConsumer(cb: (params: { files?: FileSystemFileHandle[] }) => void): void
    }
  }
}

// Consumidor del File Handling API ("Abrir con Gestor Familiar" desde el
// explorador del PC): el SO lanza /abrir y entrega los handles por launchQueue.
// Sin launchQueue (navegador no compatible) la página sigue útil como subida manual.
export default function AperturaSistema({
  raicesComun,
  raicesPrivadas,
  userId,
  isAdmin,
}: {
  raicesComun: Carpeta[]
  raicesPrivadas: Carpeta[]
  userId: string
  isAdmin: boolean
}) {
  const [lote, setLote] = useState(0)
  const [externos, setExternos] = useState<File[]>([])

  useEffect(() => {
    if (!('launchQueue' in window) || !window.launchQueue) return
    window.launchQueue.setConsumer(async (params) => {
      const handles = params.files ?? []
      if (handles.length === 0) return
      const ficheros: File[] = []
      for (const h of handles) {
        try {
          ficheros.push(await h.getFile())
        } catch {
          // handle ilegible: se omite sin abortar el resto
        }
      }
      if (ficheros.length > 0) {
        setExternos(ficheros)
        setLote((n) => n + 1)
      }
    })
  }, [])

  return (
    <div>
      <p className="login-subtitle" style={{ marginBottom: '12px' }}>
        {externos.length > 0
          ? `${externos.length} archivo(s) recibidos del sistema. Elige dónde guardarlos.`
          : 'Abre un archivo con «Gestor Familiar» desde tu explorador y aparecerá aquí. Si tu sistema no lo ofrece, elígelo manualmente:'}
      </p>
      <GuardadoManual
        key={lote}
        raicesComun={raicesComun}
        raicesPrivadas={raicesPrivadas}
        userId={userId}
        isAdmin={isAdmin}
        externos={externos}
      />
    </div>
  )
}
