'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Share2, Loader2 } from 'lucide-react'
import { enviarArchivo, registrarEnvioExterno } from '@/actions/files'
import { resolverSeleccion } from '@/actions/seleccion'
import { avisar } from '@/components/Avisos'

const MAX_ENVIO = 10 // tope por envío: los blobs viven en memoria del móvil
const MAX_PRECARGA = 80 * 1024 * 1024 // no descargar solo si supera 80 MB
const ESPERA_PRECARGA = 500 // deja que la selección se asiente antes de descargar

type NavigatorConShare = Navigator & {
  share?: (datos: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (datos: { files: File[] }) => boolean
}

type Estado = 'inactivo' | 'preparando' | 'listo' | 'omitido' | 'error' | 'solo-carpetas'

// Compartir archivos con otra app (WhatsApp, correo…) sin guardarlos en disco.
//
// `navigator.share()` exige un GESTO DE USUARIO VIVO (~5 s): no se puede llamar
// después de descargar los blobs. Por eso se PRECARGAN en segundo plano en
// cuanto la selección se asienta, y el toque en «Compartir (N)» llama a share()
// sin ningún await previo. Si la selección supera MAX_PRECARGA (o el navegador
// no deja compartir archivos), queda el flujo de dos toques: preparar y enviar.
export default function EnviarSeleccionButton({ ids }: { ids: string[] }) {
  const [estado, setEstado] = useState<Estado>('inactivo')
  const [ficheros, setFicheros] = useState<File[]>([])
  const [idsFicheros, setIdsFicheros] = useState<string[]>([])
  const [numArchivos, setNumArchivos] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [avisoCarpetas, setAvisoCarpetas] = useState(false)
  const [avisoLimite, setAvisoLimite] = useState(false)
  const controlRef = useRef<AbortController | null>(null)

  // ¿El navegador sabe compartir archivos? Se comprueba con un File de prueba
  // para no ofrecer un botón que luego falle con PDFs o vídeos.
  const [soportado] = useState(() => {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as NavigatorConShare
    if (typeof nav.share !== 'function') return false
    if (!nav.canShare) return true
    try {
      return nav.canShare({ files: [new File([''], 'prueba.txt', { type: 'text/plain' })] })
    } catch {
      return false
    }
  })

  // La clave evita depender de la identidad del array (que cambia en cada render).
  const clave = ids.join(',')
  const idsActuales = useMemo(() => (clave ? clave.split(',') : []), [clave])

  const preparar = useCallback(
    async (manual: boolean) => {
      if (idsActuales.length === 0) return
      const nav = navigator as NavigatorConShare
      if (!nav.share) return

      controlRef.current?.abort()
      const control = new AbortController()
      controlRef.current = control
      setEstado('preparando')
      setError(null)

      try {
        const sel = await resolverSeleccion(idsActuales)
        if ('error' in sel) throw new Error(sel.error ?? 'No se pudo leer la selección.')
        if (control.signal.aborted) return

        const archivos = sel.archivos.slice(0, MAX_ENVIO)
        setNumArchivos(archivos.length)
        setAvisoCarpetas(sel.carpetas.length > 0)
        setAvisoLimite(sel.archivos.length > MAX_ENVIO)

        if (archivos.length === 0) {
          setEstado('solo-carpetas')
          return
        }

        // Selecciones muy grandes: no se descargan solas. El primer toque
        // prepara y el segundo comparte (evita gastar datos sin querer).
        const total = archivos.reduce((suma, a) => suma + (a.tamano_bytes ?? 0), 0)
        if (!manual && total > MAX_PRECARGA) {
          setEstado('omitido')
          return
        }

        // En paralelo: firmar y descargar todos a la vez, no uno detrás de otro.
        const lista = await Promise.all(
          archivos.map(async (a) => {
            const res = await enviarArchivo(a.id, false)
            if (!('url' in res) || !res.url) {
              throw new Error(('error' in res && res.error) || `No se pudo preparar «${a.nombre_original}».`)
            }
            const r = await fetch(res.url, { credentials: 'omit', signal: control.signal })
            if (!r.ok) throw new Error(`No se pudo obtener «${a.nombre_original}».`)
            const blob = await r.blob()
            return {
              file: new File([blob], res.nombreOriginal ?? a.nombre_original, {
                type: res.tipoMime || blob.type,
              }),
              id: a.id,
            }
          })
        )

        if (control.signal.aborted) return
        const listaFicheros = lista.map((x) => x.file)
        if (nav.canShare && !nav.canShare({ files: listaFicheros })) throw new Error('no-soportado')

        setFicheros(listaFicheros)
        setIdsFicheros(lista.map((x) => x.id))
        setEstado('listo')
      } catch (e) {
        if (control.signal.aborted) return
        const mensaje =
          e instanceof Error && e.message !== 'no-soportado'
            ? e.message
            : 'Este navegador no permite enviar estos archivos. Descárgalos uno por uno.'
        setError(mensaje)
        setEstado('error')
        // Los fallos de la precarga automática son silenciosos: solo se avisa
        // cuando el usuario pide compartir de verdad.
        if (manual) avisar('error', mensaje)
      }
    },
    [idsActuales]
  )

  // Precarga automática al cambiar la selección. El componente se remonta con
  // una key por selección (FileListWrapper), así que el cleanup aborta las
  // descargas pendientes y libera los blobs anteriores.
  useEffect(() => {
    if (!soportado || idsActuales.length === 0) return
    const timer = setTimeout(() => {
      void preparar(false)
    }, ESPERA_PRECARGA)
    return () => {
      clearTimeout(timer)
      controlRef.current?.abort()
    }
  }, [idsActuales, preparar, soportado])

  // Sin ningún await entre el toque y share(): este es el gesto que pide el navegador.
  function compartirAhora() {
    const nav = navigator as NavigatorConShare
    if (!nav.share || ficheros.length === 0) return

    try {
      const envio = nav.share({
        files: ficheros,
        title: ficheros.length === 1 ? ficheros[0].name : `${ficheros.length} archivos`,
      })
      envio
        .then(() => {
          // Solo se audita si el envío llegó a completarse (no en cancelaciones)
          void registrarEnvioExterno(idsFicheros)
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return // menú cerrado: silencio
          avisar('error', 'No se pudo abrir el menú de compartir. Inténtalo otra vez.')
        })
      if (avisoCarpetas) avisar('info', 'Las carpetas no se envían: solo viajan los archivos.')
      if (avisoLimite) avisar('info', `Solo se envían los primeros ${MAX_ENVIO} archivos.`)
    } catch {
      avisar('error', 'No se pudo abrir el menú de compartir. Inténtalo otra vez.')
    }
  }

  if (!soportado) return null

  // Selección vacía: botón inerte para no romper la barra.
  if (idsActuales.length === 0) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled
        style={{ minHeight: '36px' }}
      >
        <Share2 size={14} />
        Compartir
      </button>
    )
  }

  if (estado === 'solo-carpetas') {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled
        style={{ minHeight: '36px' }}
        title="Las carpetas no se envían: selecciona algún archivo"
      >
        <Share2 size={14} />
        Solo archivos
      </button>
    )
  }

  if (estado === 'listo') {
    return (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={compartirAhora}
        style={{ minHeight: '36px' }}
        title="Abre el menú del sistema para elegir la app"
      >
        <Share2 size={14} />
        Compartir ({ficheros.length})
      </button>
    )
  }

  const preparandoUI = estado === 'preparando' || estado === 'inactivo'
  const cuenta = numArchivos || idsActuales.length
  const etiqueta =
    estado === 'omitido'
      ? `Preparar envío (${cuenta})`
      : estado === 'error'
        ? `Reintentar (${cuenta})`
        : preparandoUI
          ? 'Preparando…'
          : `Compartir (${cuenta})`

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        if (estado === 'preparando') return
        void preparar(true)
      }}
      disabled={preparandoUI}
      style={{ minHeight: '36px' }}
      title={error ?? (preparandoUI ? 'Preparando los archivos…' : 'Prepara los archivos y ábrelos en otra app')}
    >
      {preparandoUI ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
      {etiqueta}
    </button>
  )
}
