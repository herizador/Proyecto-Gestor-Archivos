'use client'

import { useState, useMemo } from 'react'
import { Share2, X, Check, Link, List } from 'lucide-react'
import { generarEnlaceCompartido } from '@/actions/share'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

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
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shareLoading, setShareLoading] = useState(false)
  const [shareResult, setShareResult] = useState<{ url: string } | { error: string } | null>(null)

  const allIds = useMemo(() => {
    const fileIds = archivos.map(a => a.id)
    const folderIds = carpetas.map(c => c.id)
    return [...folderIds, ...fileIds]
  }, [archivos, carpetas])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id)
      return [...prev, id]
    })
    setShareResult(null)
  }

  function handleToggleAll() {
    if (selectedIds.length === allIds.length) {
      setSelectedIds([])
    } else {
      setSelectedIds([...allIds])
    }
    setShareResult(null)
  }

  function exitSelectionMode() {
    setIsSelectionMode(false)
    setSelectedIds([])
    setShareResult(null)
  }

  async function handleShare() {
    const archivoIds: string[] = []
    const carpetaIds: string[] = []
    const carpetaIdSet = new Set(carpetas.map(c => c.id))

    selectedIds.forEach(id => {
      if (carpetaIdSet.has(id)) carpetaIds.push(id)
      else archivoIds.push(id)
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
  }

  const isAllSelected = selectedIds.length === allIds.length && allIds.length > 0
  const hasItems = allIds.length > 0

  return (
    <div>
      {/* Barra de selección */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 16px',
          marginBottom: '16px',
          borderRadius: 'var(--radius-md)',
          flexWrap: 'wrap',
          ...(isSelectionMode
            ? { background: 'var(--color-accent-dim)', border: '1px solid rgba(79,142,247,0.25)' }
            : {}),
        }}
      >
        {!isSelectionMode ? (
          hasItems && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setIsSelectionMode(true)}
              style={{ minHeight: '36px' }}
            >
              <List size={16} />
              Seleccionar
            </button>
          )
        ) : (
          <>
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-accent)' }}>
              {selectedIds.length} seleccionado{selectedIds.length !== 1 ? 's' : ''}
            </span>

            <button type="button" className="btn btn-ghost btn-sm" onClick={handleToggleAll} style={{ minHeight: '36px' }}>
              <Check size={14} />
              {isAllSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </button>

            <button type="button" className="btn btn-ghost btn-sm" onClick={exitSelectionMode} style={{ minHeight: '36px' }}>
              <X size={14} />
              Cancelar
            </button>

            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleShare}
                disabled={shareLoading || selectedIds.length === 0}
                style={{ minHeight: '36px' }}
              >
                <Share2 size={14} />
                {shareLoading ? 'Generando...' : 'Compartir Seleccionados'}
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
          </>
        )}
      </div>

      {carpetas.length > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h2 className="section-title">Carpetas</h2>
          <div className="grid-folders">
            {carpetas.map((carpeta) => (
              <FolderCard
                key={carpeta.id}
                carpeta={carpeta}
                selected={isSelectionMode && selectedIds.includes(carpeta.id)}
                onToggleSelect={isSelectionMode ? toggleSelect : undefined}
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
                selected={isSelectionMode && selectedIds.includes(archivo.id)}
                onToggleSelect={isSelectionMode ? toggleSelect : undefined}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
