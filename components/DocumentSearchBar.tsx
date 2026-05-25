'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { buscarArchivos } from '@/actions/files'
import FileCard from '@/components/FileCard'
import type { ArchivoConAutor } from '@/types/database'

export default function DocumentSearchBar({
  userId,
  isAdmin,
  children,
}: {
  userId: string
  isAdmin: boolean
  children?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<ArchivoConAutor[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    buscarArchivos(debouncedQuery).then((res) => {
      if (cancelled) return
      setResults(res.data ?? [])
      setSearched(true)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const isSearching = debouncedQuery.length > 0

  return (
    <div className="search-section">
      <div className="search-bar-wrap">
        <Search size={18} className="search-bar-icon" />
        <input
          type="text"
          className="input search-bar-input"
          placeholder="Buscar documentos por nombre..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar documentos"
        />
        {query && (
          <button
            type="button"
            className="btn-ghost btn-icon search-bar-clear"
            onClick={() => setQuery('')}
            title="Limpiar búsqueda"
          >
            <X size={16} />
          </button>
        )}
        {loading && <Loader2 size={18} className="animate-spin search-bar-spinner" />}
      </div>

      {!isSearching && children}

      {isSearching && (
        <div className="search-results">
          <p className="search-results-label">
            {loading
              ? 'Buscando...'
              : `${results.length} resultado${results.length === 1 ? '' : 's'} para «${debouncedQuery}»`}
          </p>
          {!loading && searched && results.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              No se encontraron archivos activos con ese nombre.
            </p>
          )}
          {results.length > 0 && (
            <div className="grid-files">
              {results.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  isAdmin={isAdmin}
                  isOwner={file.subido_por === userId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
