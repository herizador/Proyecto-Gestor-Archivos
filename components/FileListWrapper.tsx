'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Share2, X, Check, Link, List } from 'lucide-react'
import { generarEnlaceCompartido } from '@/actions/share'
import { eliminarAcceso, type ObjetivoEnlace } from '@/actions/accesos'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import EnlazarSeleccionModal from '@/components/EnlazarSeleccionModal'
import EnviarSeleccionButton from '@/components/EnviarSeleccionButton'
import MoverSeleccionModal from '@/components/MoverSeleccionModal'
import BarraOrdenVista, { type Orden, type Vista } from '@/components/BarraOrdenVista'
import { FilaArchivo, FilaCarpeta } from '@/components/VistaLista'
import { avisar } from '@/components/Avisos'
import type { AccesoConObjetivo, ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

function porFechaDesc(a: string, b: string) {
  return +new Date(b) - +new Date(a)
}

// Los accesos se muestran con datos derivados (personalizado u original);
// estas ayudas unifican rejilla y lista para que ordenen y muestren igual.
function displayAccesoArchivo(a: AccesoConObjetivo) {
  const objetivo = a.archivo_objetivo
  return {
    file: {
      id: a.id,
      nombre_original: a.nombre_personalizado || objetivo?.nombre_original || 'Enlace no disponible',
      ruta_r2: '',
      tamano_bytes: objetivo?.tamano_bytes ?? 0,
      tipo_mime: objetivo?.tipo_mime ?? 'application/octet-stream',
      carpeta_id: a.carpeta_contenedora_id,
      subido_por: objetivo?.subido_por ?? a.creado_por,
      estado: 'activo',
      fecha_subida: objetivo?.fecha_subida ?? a.fecha_creacion,
      fecha_papelera: null,
      subido_por_perfil: objetivo?.subido_por_perfil ?? null,
    } as ArchivoConAutor,
    huerfano: !objetivo || objetivo.estado !== 'activo',
    origenNombre: objetivo?.carpeta?.nombre ?? 'otra ubicación',
  }
}

function displayAccesoCarpeta(a: AccesoConObjetivo) {
  const objetivo = a.carpeta_objetivo
  return {
    carpeta: {
      id: objetivo?.id ?? a.id,
      nombre: a.nombre_personalizado || objetivo?.nombre || 'Enlace no disponible',
      color: objetivo?.color ?? 'indigo',
      creado_por: a.creado_por,
      es_privada: false,
      carpeta_padre_id: null,
      fecha_creacion: a.fecha_creacion,
    } as CarpetaConAutor,
    huerfano: !objetivo,
    origenNombre: objetivo?.padre?.nombre ?? 'otra ubicación',
  }
}

export default function FileListWrapper({
  archivos,
  carpetas,
  accesos = [],
  isAdmin,
  userId,
  showOwner = false,
  basePath = '/',
  ordenExterno,
  vistaExterna,
  ocultarBarra = false,
  alCambiarOrden,
  alCambiarVista,
}: {
  archivos: ArchivoConAutor[]
  carpetas: CarpetaConAutor[]
  accesos?: AccesoConObjetivo[]
  isAdmin: boolean
  userId: string
  showOwner?: boolean
  basePath?: string
  ordenExterno?: Orden
  vistaExterna?: Vista
  ocultarBarra?: boolean
  alCambiarOrden?: (o: Orden) => void
  alCambiarVista?: (v: Vista) => void
}) {
  const router = useRouter()
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shareLoading, setShareLoading] = useState(false)
  const [shareResult, setShareResult] = useState<{ url: string } | { error: string } | null>(null)

  // Los accesos no entran en la selección para compartir (límite conocido:
  // /compartir solo resuelve archivos reales); se gestionan aparte.
  // Los huérfanos (ambos objetivos NULL) se muestran como tarjetas de archivo.
  const accesosArchivos = useMemo(() => accesos.filter((a) => a.carpeta_objetivo_id === null), [accesos])
  const accesosCarpetas = useMemo(() => accesos.filter((a) => a.carpeta_objetivo_id !== null), [accesos])

  async function handleEliminarAcceso(accesoId: string) {
    const res = await eliminarAcceso(accesoId)
    if (res.error) avisar('error', res.error)
    else {
      avisar('exito', 'Enlace eliminado.')
      router.refresh()
    }
  }

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

  const [ordenInterno, setOrdenInterno] = useState<Orden>('recientes')
  const [vistaInterna, setVistaInterna] = useState<Vista>('cuadricula')
  const orden = ordenExterno ?? ordenInterno
  const vista = vistaExterna ?? vistaInterna
  function cambiarOrden(o: Orden) {
    if (alCambiarOrden) alCambiarOrden(o)
    else setOrdenInterno(o)
  }
  function cambiarVista(v: Vista) {
    if (alCambiarVista) alCambiarVista(v)
    else setVistaInterna(v)
  }

  // Ordenación en cliente (sin idas extra): recientes, nombre A-Z o tamaño
  const cmpArchivos = useMemo(() => {
    const fns: Record<Orden, (a: ArchivoConAutor, b: ArchivoConAutor) => number> = {
      recientes: (a, b) => porFechaDesc(a.fecha_subida, b.fecha_subida),
      nombre: (a, b) => a.nombre_original.localeCompare(b.nombre_original, 'es'),
      tamano: (a, b) => b.tamano_bytes - a.tamano_bytes,
    }
    return fns[orden]
  }, [orden])
  const cmpCarpetas = useMemo(() => {
    const fns: Record<Orden, (a: CarpetaConAutor, b: CarpetaConAutor) => number> = {
      recientes: (a, b) => porFechaDesc(a.fecha_creacion, b.fecha_creacion),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      tamano: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    return fns[orden]
  }, [orden])

  const archivosOrdenados = useMemo(() => [...archivos].sort(cmpArchivos), [archivos, cmpArchivos])
  const carpetasOrdenadas = useMemo(() => [...carpetas].sort(cmpCarpetas), [carpetas, cmpCarpetas])
  const accesosArchivosOrdenados = useMemo(
    () => [...accesosArchivos].sort((a, b) => {
      const da = displayAccesoArchivo(a)
      const db = displayAccesoArchivo(b)
      if (orden === 'nombre') return da.file.nombre_original.localeCompare(db.file.nombre_original, 'es')
      if (orden === 'tamano') return db.file.tamano_bytes - da.file.tamano_bytes
      return porFechaDesc(da.file.fecha_subida, db.file.fecha_subida)
    }),
    [accesosArchivos, orden]
  )
  const accesosCarpetasOrdenados = useMemo(
    () => [...accesosCarpetas].sort((a, b) => {
      const da = displayAccesoCarpeta(a)
      const db = displayAccesoCarpeta(b)
      if (orden === 'nombre') return da.carpeta.nombre.localeCompare(db.carpeta.nombre, 'es')
      return porFechaDesc(da.carpeta.fecha_creacion, db.carpeta.fecha_creacion)
    }),
    [accesosCarpetas, orden]
  )

  const enLista = vista === 'lista'
  const sel = (id: string) => isSelectionMode && selectedIds.includes(id)
  const alAlternar = isSelectionMode ? toggleSelect : undefined

  // Objetivos para el enlace en lote: los accesos nunca entran en allIds,
  // así que aquí solo hay archivos y carpetas reales.
  const objetivosEnlace = useMemo<ObjetivoEnlace[]>(() => {
    const carpetaIdSet = new Set(carpetas.map((c) => c.id))
    const nombresArchivos = new Map(archivos.map((a) => [a.id, a.nombre_original]))
    const nombresCarpetas = new Map(carpetas.map((c) => [c.id, c.nombre]))
    return selectedIds.flatMap((id): ObjetivoEnlace[] => {
      if (carpetaIdSet.has(id)) {
        const nombre = nombresCarpetas.get(id)
        return nombre ? [{ tipo: 'carpeta', id, nombre }] : []
      }
      const nombre = nombresArchivos.get(id)
      return nombre ? [{ tipo: 'archivo', id, nombre }] : []
    })
  }, [selectedIds, archivos, carpetas])

  function handleEnlazados() {
    exitSelectionMode()
    router.refresh()
  }

  function handleMovidos() {
    exitSelectionMode()
    router.refresh()
  }

  // Archivos seleccionados para Enviar (las carpetas no viajan como ficheros)
  const archivosParaEnviar = useMemo(
    () => {
      const nombres = new Map(archivos.map((a) => [a.id, a.nombre_original]))
      return selectedIds.flatMap((id) => {
        const nombre = nombres.get(id)
        return nombre ? [{ id, nombre }] : []
      })
    },
    [selectedIds, archivos]
  )

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

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <EnviarSeleccionButton archivos={archivosParaEnviar} />
              <MoverSeleccionModal
                objetivos={objetivosEnlace}
                basePath={basePath}
                onMovidos={handleMovidos}
              />
              <EnlazarSeleccionModal
                objetivos={objetivosEnlace}
                basePath={basePath}
                onEnlazados={handleEnlazados}
              />
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

      {/* Barra de orden y vista (en Área Común vive en la fila de búsqueda) */}
      {!ocultarBarra && hasItems && (
        <BarraOrdenVista orden={orden} vista={vista} onOrden={cambiarOrden} onVista={cambiarVista} />
      )}

      {(carpetas.length > 0 || accesosCarpetas.length > 0) && (
        <section style={{ marginBottom: '24px' }}>
          <h2 className="section-title">Carpetas</h2>
          {enLista ? (
            <div className="lista-archivos">
              {carpetasOrdenadas.map((carpeta) => (
                <FilaCarpeta
                  key={carpeta.id}
                  carpeta={carpeta}
                  selected={sel(carpeta.id)}
                  onToggleSelect={alAlternar}
                  basePath={basePath}
                  crearEnlace={(isAdmin || carpeta.creado_por === userId) ? (
                    <NuevoAccesoModal objetivoTipo="carpeta" objetivoId={carpeta.id} objetivoNombre={carpeta.nombre} />
                  ) : null}
                  puedeRenombrar={isAdmin || carpeta.creado_por === userId}
                />
              ))}
              {accesosCarpetasOrdenados.map((acceso) => {
                const d = displayAccesoCarpeta(acceso)
                return (
                  <FilaCarpeta
                    key={acceso.id}
                    carpeta={d.carpeta}
                    basePath={basePath}
                    esAcceso
                    accesoId={acceso.id}
                    origenNombre={d.origenNombre}
                    huerfano={d.huerfano}
                    onEliminarAcceso={handleEliminarAcceso}
                  />
                )
              })}
            </div>
          ) : (
          <div className="grid-folders">
            {carpetasOrdenadas.map((carpeta) => (
              <FolderCard
                key={carpeta.id}
                carpeta={carpeta}
                selected={sel(carpeta.id)}
                onToggleSelect={alAlternar}
                basePath={basePath}
                crearEnlace={(isAdmin || carpeta.creado_por === userId) ? (
                  <NuevoAccesoModal objetivoTipo="carpeta" objetivoId={carpeta.id} objetivoNombre={carpeta.nombre} />
                ) : null}
                puedeRenombrar={isAdmin || carpeta.creado_por === userId}
              />
            ))}
            {accesosCarpetasOrdenados.map((acceso) => {
              const d = displayAccesoCarpeta(acceso)
              return (
                <FolderCard
                  key={acceso.id}
                  carpeta={d.carpeta}
                  basePath={basePath}
                  esAcceso
                  accesoId={acceso.id}
                  origenNombre={d.origenNombre}
                  huerfano={d.huerfano}
                  onEliminarAcceso={handleEliminarAcceso}
                />
              )
            })}
          </div>
          )}
        </section>
      )}

      {(archivos.length > 0 || accesosArchivos.length > 0) && (
        <section>
          {(carpetas.length > 0 || accesosCarpetas.length > 0) && <h2 className="section-title">Archivos</h2>}
          {enLista ? (
            <div className="lista-archivos">
              {archivosOrdenados.map((archivo) => (
                <FilaArchivo
                  key={archivo.id}
                  file={archivo}
                  isAdmin={isAdmin}
                  isOwner={archivo.subido_por === userId || showOwner}
                  selected={sel(archivo.id)}
                  onToggleSelect={alAlternar}
                />
              ))}
              {accesosArchivosOrdenados.map((acceso) => {
                const d = displayAccesoArchivo(acceso)
                return (
                  <FilaArchivo
                    key={acceso.id}
                    file={d.file}
                    isAdmin={isAdmin}
                    isOwner={acceso.creado_por === userId || isAdmin}
                    esAcceso
                    origenNombre={d.origenNombre}
                    huerfano={d.huerfano}
                  />
                )
              })}
            </div>
          ) : (
          <div className="grid-files">
            {archivosOrdenados.map((archivo) => (
              <FileCard
                key={archivo.id}
                file={archivo}
                isAdmin={isAdmin}
                isOwner={archivo.subido_por === userId || showOwner}
                selected={sel(archivo.id)}
                onToggleSelect={alAlternar}
              />
            ))}
            {accesosArchivosOrdenados.map((acceso) => {
              const d = displayAccesoArchivo(acceso)
              return (
                <FileCard
                  key={acceso.id}
                  file={d.file}
                  isAdmin={isAdmin}
                  isOwner={acceso.creado_por === userId || isAdmin}
                  esAcceso
                  origenNombre={d.origenNombre}
                  huerfano={d.huerfano}
                />
              )
            })}
          </div>
          )}
        </section>
      )}
    </div>
  )
}
