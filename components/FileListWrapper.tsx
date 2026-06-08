'use client'

import { useState, useCallback, useMemo } from 'react'
import { Share2, X, Check, Link } from 'lucide-react'
import { generarEnlaceCompartido } from '@/actions/share'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

type ShareResult = { url: string } | { error: string }

export default function FileListWrapper({
  archivos,
  carpetas,
  isAdmin,
  userId,
  carpetaActualId,
  showOwner = false,
}: {
  archivos: ArchivoConAutor[]
  carpetas: CarpetaConAutor[]
  isAdmin: boolean
  userId: string
  carpetaActualId?: string | null
  showOwner?: boolean
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [shareLoading, setShareLoading] = useState(false)
  const [shareResult, setShareResult] = useState<ShareResult | null>(null)

  const allIds = useMemo(() => {
    const fileIds = archivos.map(a => `file_${a.id}`)
    const folderIds = carpetas.map(c => `carpeta_${c.id}`)
    return [...folderIds, ...fileIds]
  }, [archivos, carpetas])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setShareResult(null)
  }, [])

  const handleToggleAll = useCallback(() => {
    if (selectedIds.size === allIds.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
    setShareResult(null)
  }, [selectedIds, allIds])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setShareResult(null)
  }, [])

  const handleShare = useCallback(async () => {
    const archivoIds: string[] = []
    const carpetaIds: string[] = []

    selectedIds.forEach(id => {
      if (id.startsWith('carpeta_')) carpetaIds.push(id.slice(8))
      else if (id.startsWith('file_')) archivoIds.push(id.slice(5))
    })

    setShareLoading(true)
    const result = await generarEnlaceCompartido({ archivoIds, carpetaIds })
    setShareLoading(false)

    if ('url' in result && result.url) {
      setShareResult({ url: result.url })
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await navigator.share({ title: 'Compartir documentos', url: result.url })
        } catch {
          // user cancelled
        }
      }
    } else {
      setShareResult({ error: ('error' in result ? result.error : 'Error al generar enlace') ?? 'Error al generar enlace' })
    }
  }, [selectedIds])

  const isAllSelected = selectedIds.size === allIds.length && allIds.length > 0

  return (
    <div>
      {selectedIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            marginBottom: '16px',
            background: 'var(--color-accent-dim)',
            border: '1px solid rgba(79,142,247,0.25)',
            borderRadius: 'var(--radius-md)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-accent)' }}>
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>

          <button type="button" className="btn btn-ghost btn-sm" onClick={handleToggleAll} style={{ minHeight: '36px' }}>
            <Check size={14} />
            {isAllSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
          </button>

          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} style={{ minHeight: '36px' }}>
            <X size={14} />
            Limpiar
          </button>

          <div style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleShare}
              disabled={shareLoading}
              style={{ minHeight: '36px' }}
            >
              <Share2 size={14} />
              {shareLoading ? 'Generando...' : 'Compartir'}
            </button>
          </div>

          {shareResult && 'url' in shareResult && (
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <Link size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <input
                type="text"
                className="input"
                value={shareResult.url}
                readOnly
                style={{ fontSize: '0.8rem', padding: '6px 10px', flex: 1 }}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard.writeText(shareResult.url)}
                style={{ minHeight: '36px', flexShrink: 0 }}
                title="Copiar enlace"
              >
                Copiar
              </button>
            </div>
          )}

          {shareResult && 'error' in shareResult && (
            <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem', width: '100%' }}>
              {shareResult.error}
            </span>
          )}
        </div>
      )}

      {carpetas.length > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 className="section-title">Carpetas</h2>
          <div className="grid-folders">
            {carpetas.map((carpeta) => (
              <FolderCard
                key={carpeta.id}
                carpeta={carpeta}
                selected={selectedIds.has(`carpeta_${carpeta.id}`)}
                onToggleSelect={toggleSelect}
                carpetaActualId={carpetaActualId}
              />
            ))}
          </div>
        </section>
      )}

      {archivos.length > 0 && (
        <section>
          {carpetas.length > 0 && <h2 className="section-title">Archivos</h2>}
          <div className="grid-files">
            {archivos.map((archivo) => (
              <FileCard
                key={archivo.id}
                file={archivo}
                isAdmin={isAdmin}
                isOwner={archivo.subido_por === userId || showOwner}
                selected={selectedIds.has(`file_${archivo.id}`)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
