'use client'

import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Share2, X, Check, Link, List, Trash2 } from 'lucide-react'
import { generarEnlaceCompartido } from '@/actions/share'
import { eliminarAcceso } from '@/actions/accesos'
import { alternarFavorito } from '@/actions/favoritos'
import { moverAPapeleraBatch } from '@/actions/files'
import { resolverSeleccion } from '@/actions/seleccion'
import { useSeleccion, fijarSeleccion, obtenerSeleccion } from '@/lib/seleccion'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import EnlazarSeleccionModal from '@/components/EnlazarSeleccionModal'
import EnviarSeleccionButton from '@/components/EnviarSeleccionButton'
import MoverSeleccionModal from '@/components/MoverSeleccionModal'
import BarraOrdenVista, { type Orden, type Vista } from '@/components/BarraOrdenVista'
import { FilaArchivo, FilaCarpeta } from '@/components/VistaLista'
import { avisar, confirmar } from '@/components/Avisos'
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
  favoritosIniciales = [],
  ubicaciones = {},
  modoSeleccionExterno,
  alCambiarModo,
  ocultarSeleccion = false,
  tituloArchivos = null,
  limiteInicial = 0,
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
  favoritosIniciales?: string[]
  ubicaciones?: Record<string, string>
  modoSeleccionExterno?: boolean
  alCambiarModo?: (v: boolean) => void
  ocultarSeleccion?: boolean
  tituloArchivos?: string | null
  limiteInicial?: number
}) {
  const router = useRouter()
  // Modo compartible con la fila de búsqueda (ExploradorArchivos): si hay
  // selección global al montar (venimos de otra carpeta), arranca activo para
  // no confundir. En SSR el store está vacío en ambos lados: sin mismatch.
  const [modoInt, setModoInt] = useState(() => modoSeleccionExterno ?? obtenerSeleccion().length > 0)
  const isSelectionMode = modoSeleccionExterno ?? modoInt
  function setModo(v: boolean) {
    if (alCambiarModo) alCambiarModo(v)
    else setModoInt(v)
  }
  // Selección GLOBAL de la sesión (lib/seleccion.ts): sobrevive a navegar
  // entre carpetas; al actuar se rehidrata con resolverSeleccion().
  const selectedIds = useSeleccion()
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
    fijarSeleccion(
      selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]
    )
    setShareResult(null)
  }

  // "Todos" opera sobre la vista actual (la selección puede traer de otras)
  function handleToggleAll() {
    const aqui = new Set(allIds)
    const todosAqui = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
    fijarSeleccion(todosAqui ? selectedIds.filter((id) => !aqui.has(id)) : [...selectedIds, ...allIds.filter((id) => !selectedIds.includes(id))])
    setShareResult(null)
  }

  function exitSelectionMode() {
    setModo(false)
    fijarSeleccion([])
    setShareResult(null)
  }

  async function handleShare() {
    if (selectedIds.length === 0) return
    setShareLoading(true)
    try {
      const sel = await resolverSeleccion(selectedIds)
      if ('error' in sel) {
        setShareResult({ error: sel.error ?? 'No se pudo leer la selección.' })
        return
      }
      const result = await generarEnlaceCompartido({
        archivoIds: sel.archivos.map((a) => a.id),
        carpetaIds: sel.carpetas.map((c) => c.id),
      })
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
    } finally {
      setShareLoading(false)
    }
  }

  async function handlePapeleraLote() {
    if (selectedIds.length === 0) return
    const sel = await resolverSeleccion(selectedIds)
    if ('error' in sel) {
      avisar('error', sel.error ?? 'No se pudo leer la selección.')
      return
    }
    const idsArchivos = sel.archivos.map((a) => a.id)
    if (sel.carpetas.length > 0) {
      avisar('info', 'Las carpetas no van a la papelera: elimínalas una a una desde su menú.')
    }
    if (idsArchivos.length === 0) return
    const ok = await confirmar({
      titulo: 'Mover a papelera',
      mensaje: `¿Mover ${idsArchivos.length} archivo(s) a la papelera?`,
      textoOk: 'Mover',
      peligroso: true,
    })
    if (!ok) return
    const res = await moverAPapeleraBatch(idsArchivos)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    if ('success' in res && res.success) {
      if (res.movidos > 0) avisar('exito', `${res.movidos} archivo(s) a la papelera.`)
      for (const f of res.fallidos ?? []) avisar('error', `«${f.nombre}»: ${f.error}`)
      exitSelectionMode()
      router.refresh()
    }
  }

  // "Todos" se refiere a la vista actual (la selección puede traer de otras)
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
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

  // Favoritos: estado local optimista sobre los ids iniciales del servidor
  const [favs, setFavs] = useState<Set<string>>(() => new Set(favoritosIniciales))

  async function handleFavorito(tipo: 'archivo' | 'carpeta', id: string) {
    const clave = `${tipo === 'archivo' ? 'a' : 'c'}:${id}`
    const tenia = favs.has(clave)
    setFavs((prev) => {
      const siguiente = new Set(prev)
      if (tenia) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
    const res = await alternarFavorito({ tipo, id })
    if ('error' in res && res.error) {
      setFavs((prev) => {
        const siguiente = new Set(prev)
        if (tenia) siguiente.add(clave)
        else siguiente.delete(clave)
        return siguiente
      })
      avisar('error', res.error)
    }
  }

  const esFavArchivo = (id: string) => favs.has(`a:${id}`)
  const esFavCarpeta = (id: string) => favs.has(`c:${id}`)

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

  // Vista previa con "Mostrar todos": recorta los archivos (los accesos, pocos,
  // van siempre enteros). Sin límite no recorta nada.
  const [expandido, setExpandido] = useState(false)
  const recortado = limiteInicial > 0 && !expandido && archivosOrdenados.length > limiteInicial
  const archivosVisibles = recortado ? archivosOrdenados.slice(0, limiteInicial) : archivosOrdenados
  const tituloArchivosFinal = tituloArchivos ?? ((carpetas.length > 0 || accesosCarpetas.length > 0) ? 'Archivos' : null)

  const enLista = vista === 'lista'
  const sel = (id: string) => isSelectionMode && selectedIds.includes(id)
  const alAlternar = isSelectionMode ? toggleSelect : undefined

  // Objetivos para el enlace en lote: los accesos nunca entran en allIds,
  // así que aquí solo hay archivos y carpetas reales. (Los modales de lote
  // rehidratan por ids via resolverSeleccion: vale entre carpetas.)

  function handleEnlazados() {
    exitSelectionMode()
    router.refresh()
  }

  function handleMovidos() {
    exitSelectionMode()
    router.refresh()
  }

  return (
    <div>
      {/* Entrada al modo selección (el resto vive en la píldora flotante) */}
      {!isSelectionMode && hasItems && !ocultarSeleccion && (
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setModo(true)}
            style={{ minHeight: '36px' }}
          >
            <List size={16} />
            Seleccionar
          </button>
        </div>
      )}

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
                  esFavorito={esFavCarpeta(carpeta.id)}
                  onAlternarFavorito={() => handleFavorito('carpeta', carpeta.id)}
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
                esFavorito={esFavCarpeta(carpeta.id)}
                onAlternarFavorito={() => handleFavorito('carpeta', carpeta.id)}
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
          {tituloArchivosFinal && <h2 className="section-title">{tituloArchivosFinal}</h2>}
          {enLista ? (
            <div className="lista-archivos">
              {archivosVisibles.map((archivo) => (
                <FilaArchivo
                  key={archivo.id}
                  file={archivo}
                  isAdmin={isAdmin}
                  isOwner={archivo.subido_por === userId || showOwner}
                  selected={sel(archivo.id)}
                  onToggleSelect={alAlternar}
                  esFavorito={esFavArchivo(archivo.id)}
                  onAlternarFavorito={() => handleFavorito('archivo', archivo.id)}
                  ubicacion={ubicaciones[archivo.id] ?? null}
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
            {archivosVisibles.map((archivo) => (
              <FileCard
                key={archivo.id}
                file={archivo}
                isAdmin={isAdmin}
                isOwner={archivo.subido_por === userId || showOwner}
                selected={sel(archivo.id)}
                onToggleSelect={alAlternar}
                esFavorito={esFavArchivo(archivo.id)}
                onAlternarFavorito={() => handleFavorito('archivo', archivo.id)}
                ubicacion={ubicaciones[archivo.id] ?? null}
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
          {recortado && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setExpandido(true)}
                style={{ minHeight: '40px' }}
              >
                Mostrar todos ({archivosOrdenados.length})
              </button>
            </div>
          )}
        </section>
      )}

      {/* Píldora flotante de selección (estilo Figma): siempre visible en modo
          selección, con todas las acciones en lote */}
      {isSelectionMode && typeof document !== 'undefined' && createPortal(
        <div className="pill-zona">
          {shareResult && ('url' in shareResult || 'error' in shareResult) && (
            <div className="pill-resultado" role="status">
              {'url' in shareResult ? (
                <>
                  <Link size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                  <input
                    type="text"
                    className="input"
                    value={shareResult.url}
                    readOnly
                    style={{ fontSize: '0.8rem', padding: '6px 10px', flex: 1, minWidth: 0 }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="Enlace generado"
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
                </>
              ) : (
                <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>
                  {(shareResult as { error: string }).error}
                </span>
              )}
            </div>
          )}
          <div className="pill-seleccion" role="toolbar" aria-label="Acciones en lote">
            <span className="pill-conteo">
              {selectedIds.length} seleccionado{selectedIds.length !== 1 ? 's' : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleToggleAll} style={{ minHeight: '36px' }} title={isAllSelected ? 'Deseleccionar la vista actual' : 'Seleccionar la vista actual'}>
              <Check size={14} />
              {isAllSelected ? 'Ninguno' : 'Todos'}
            </button>
            <EnviarSeleccionButton key={selectedIds.join(',')} ids={selectedIds} />
            <MoverSeleccionModal
              ids={selectedIds}
              basePath={basePath}
              onMovidos={handleMovidos}
            />
            <EnlazarSeleccionModal
              ids={selectedIds}
              basePath={basePath}
              onEnlazados={handleEnlazados}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleShare}
              disabled={shareLoading || selectedIds.length === 0}
              style={{ minHeight: '36px' }}
              title="Genera un enlace público para lo seleccionado"
            >
              <Share2 size={14} />
              {shareLoading ? 'Generando...' : 'Compartir por enlace'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handlePapeleraLote}
              disabled={selectedIds.length === 0}
              style={{ minHeight: '36px' }}
              title="Mueve los archivos seleccionados a la papelera"
            >
              <Trash2 size={14} />
              Papelera
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exitSelectionMode} style={{ minHeight: '36px' }} title="Salir del modo selección">
              <X size={14} />
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
