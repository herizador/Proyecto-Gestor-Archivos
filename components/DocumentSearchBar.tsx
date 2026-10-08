'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, X } from 'lucide-react'
import { buscarArchivos } from '@/actions/files'
import { buscarAccesos, eliminarAcceso } from '@/actions/accesos'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import { avisar } from '@/components/Avisos'
import type { AccesoConObjetivo, ArchivoConAutor } from '@/types/database'

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
  const [accesos, setAccesos] = useState<AccesoConObjetivo[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([])
      setAccesos([])
      setSearched(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all([buscarArchivos(debouncedQuery), buscarAccesos(debouncedQuery)]).then(([resArchivos, resAccesos]) => {
      if (cancelled) return
      setResults(resArchivos.data ?? [])
      setAccesos(resAccesos.data ?? [])
      setSearched(true)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  async function handleEliminarAcceso(accesoId: string) {
    const res = await eliminarAcceso(accesoId)
    if (res.error) avisar('error', res.error)
    else {
      avisar('exito', 'Enlace eliminado.')
      setAccesos((prev) => prev.filter((a) => a.id !== accesoId))
      router.refresh()
    }
  }

  const isSearching = debouncedQuery.length > 0
  const totalResultados = results.length + accesos.length

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
              : `${totalResultados} resultado${totalResultados === 1 ? '' : 's'} para «${debouncedQuery}»`}
          </p>
          {!loading && searched && totalResultados === 0 && (
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
          {accesos.length > 0 && (
            <>
              <p className="search-results-label" style={{ marginTop: '16px' }}>
                Enlaces ({accesos.length})
              </p>
              <div className="grid-files">
                {accesos.filter((a) => a.carpeta_objetivo_id === null).map((acceso) => {
                  const objetivo = acceso.archivo_objetivo
                  const huerfano = !objetivo || objetivo.estado !== 'activo'
                  return (
                    <FileCard
                      key={acceso.id}
                      file={{
                        id: acceso.id,
                        nombre_original: acceso.nombre_personalizado || objetivo?.nombre_original || 'Enlace no disponible',
                        ruta_r2: '',
                        tamano_bytes: objetivo?.tamano_bytes ?? 0,
                        tipo_mime: objetivo?.tipo_mime ?? 'application/octet-stream',
                        carpeta_id: acceso.carpeta_contenedora_id,
                        subido_por: objetivo?.subido_por ?? acceso.creado_por,
                        estado: 'activo',
                        fecha_subida: objetivo?.fecha_subida ?? acceso.fecha_creacion,
                        fecha_papelera: null,
                        subido_por_perfil: objetivo?.subido_por_perfil ?? null,
                      }}
                      isAdmin={isAdmin}
                      isOwner={acceso.creado_por === userId || isAdmin}
                      esAcceso
                      origenNombre={objetivo?.carpeta?.nombre ?? 'otra ubicación'}
                      huerfano={huerfano}
                    />
                  )
                })}
              </div>
              <div className="grid-folders" style={{ marginTop: '12px' }}>
                {accesos.filter((a) => a.carpeta_objetivo_id !== null).map((acceso) => {
                  const objetivo = acceso.carpeta_objetivo
                  const huerfano = !objetivo
                  return (
                    <FolderCard
                      key={acceso.id}
                      carpeta={{
                        id: objetivo?.id ?? acceso.id,
                        nombre: acceso.nombre_personalizado || objetivo?.nombre || 'Enlace no disponible',
                        creado_por: acceso.creado_por,
                        es_privada: false,
                        carpeta_padre_id: null,
                        fecha_creacion: acceso.fecha_creacion,
                      }}
                      basePath="/"
                      esAcceso
                      accesoId={acceso.id}
                      origenNombre={objetivo?.padre?.nombre ?? 'otra ubicación'}
                      huerfano={huerfano}
                      onEliminarAcceso={handleEliminarAcceso}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
