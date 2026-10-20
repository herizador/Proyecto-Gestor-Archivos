'use client'

import { useState } from 'react'
import { Share2, Loader2, X } from 'lucide-react'
import { enviarArchivo, registrarEnvioExterno } from '@/actions/files'
import { resolverSeleccion } from '@/actions/seleccion'
import { avisar } from '@/components/Avisos'

const MAX_ENVIO = 10 // tope por envío: los blobs viven en memoria del móvil

type NavigatorConShare = Navigator & {
  share?: (datos: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (datos: { files: File[] }) => boolean
}

type Preparado = { clave: string; ficheros: File[]; ids: string[] }

// Enviar N archivos a otra app (WhatsApp, correo…) sin guardarlos en disco.
//
// OJO: `navigator.share()` exige un GESTO DE USUARIO VIVO (unos 5 s). Preparar
// los ficheros es lento (firmar + descargar cada blob), así que si se llama a
// share() después de ese trabajo el navegador lo rechaza con
// "Must be handling a user gesture". Por eso va en DOS toques:
//   1) «Enviar a otra app» → descarga los blobs (puede tardar lo que haga falta)
//   2) «Compartir N ahora» → llama a share() en el mismo instante del toque
export default function EnviarSeleccionButton({
  ids,
}: {
  ids: string[]
}) {
  const [preparando, setPreparando] = useState(false)
  const [preparado, setPreparado] = useState<Preparado | null>(null)

  // Si la selección cambia, lo preparado deja de valer: se compara la firma
  // en el render en vez de resetear con un efecto (evita renders en cascada).
  const clave = ids.join(',')
  const listo = preparado && preparado.clave === clave ? preparado : null

  async function preparar() {
    if (ids.length === 0) return
    const nav = navigator as NavigatorConShare
    if (!nav.share) {
      avisar('error', 'Este navegador no permite enviar. Descarga los archivos uno por uno.')
      return
    }

    setPreparando(true)
    try {
      const sel = await resolverSeleccion(ids)
      if ('error' in sel) throw new Error(sel.error ?? 'No se pudo leer la selección.')
      if (sel.carpetas.length > 0) {
        avisar('info', 'Las carpetas no se envían: solo viajan los archivos.')
      }
      const archivos = sel.archivos.slice(0, MAX_ENVIO)
      if (archivos.length === 0) throw new Error('Nada que enviar.')
      if (sel.archivos.length > MAX_ENVIO) {
        avisar('info', `Solo se envían los primeros ${MAX_ENVIO} (límite por envío).`)
      }

      // En paralelo: firmar y descargar todos a la vez, no uno detrás de otro
      const lista = await Promise.all(
        archivos.map(async (a) => {
          const res = await enviarArchivo(a.id, false)
          if (!('url' in res) || !res.url) {
            throw new Error(('error' in res && res.error) || `No se pudo preparar «${a.nombre_original}».`)
          }
          const r = await fetch(res.url, { credentials: 'omit' })
          if (!r.ok) throw new Error(`No se pudo obtener «${a.nombre_original}».`)
          const blob = await r.blob()
          return new File([blob], res.nombreOriginal ?? a.nombre_original, {
            type: res.tipoMime || blob.type,
          })
        })
      )

      if (nav.canShare && !nav.canShare({ files: lista })) throw new Error('no-soportado')

      setPreparado({ clave, ficheros: lista, ids: archivos.map((a) => a.id) })
    } catch (e) {
      avisar(
        'error',
        e instanceof Error && e.message !== 'no-soportado'
          ? e.message
          : 'Este navegador no permite enviar estos archivos. Descárgalos uno por uno.'
      )
    } finally {
      setPreparando(false)
    }
  }

  // Sin ningún await antes de share(): este toque es el gesto que el navegador pide
  function compartirAhora() {
    if (!listo) return
    const nav = navigator as NavigatorConShare
    const enviar = listo.ficheros
    const auditados = listo.ids

    setPreparado(null)

    if (enviar.length === 0 || !nav.share) return

    try {
      nav
        .share({
          files: enviar,
          title: enviar.length === 1 ? enviar[0].name : `${enviar.length} archivos`,
        })
        .then(() => {
          // Solo se audita si el envío llegó a completarse (no en cancelaciones)
          void registrarEnvioExterno(auditados)
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return // menú cerrado: silencio
          avisar('error', 'No se pudo abrir el menú de compartir. Inténtalo otra vez.')
        })
    } catch {
      avisar('error', 'No se pudo abrir el menú de compartir. Inténtalo otra vez.')
    }
  }

  if (listo) {
    return (
      <>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={compartirAhora}
          style={{ minHeight: '36px' }}
          title="Abre el menú del sistema para elegir la app"
        >
          <Share2 size={14} />
          Compartir {listo.ficheros.length} ahora
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => setPreparado(null)}
          style={{ minHeight: '36px', minWidth: '36px' }}
          aria-label="Cancelar envío"
          title="Cancelar"
        >
          <X size={14} />
        </button>
      </>
    )
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={preparar}
      disabled={preparando || ids.length === 0}
      style={{ minHeight: '36px' }}
      title={ids.length === 0 ? 'Selecciona archivos para enviar' : 'Prepara los archivos para enviarlos a otra app'}
    >
      {preparando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
      {preparando ? 'Preparando…' : `Enviar a otra app (${ids.length})`}
    </button>
  )
}
