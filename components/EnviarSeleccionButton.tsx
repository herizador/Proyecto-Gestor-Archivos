'use client'

import { useState } from 'react'
import { Share2, Loader2 } from 'lucide-react'
import { enviarArchivo } from '@/actions/files'
import { resolverSeleccion } from '@/actions/seleccion'
import { avisar } from '@/components/Avisos'

const MAX_ENVIO = 10 // tope por envío: los blobs viven en memoria del móvil

type NavigatorConShare = Navigator & {
  share?: (datos: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (datos: { files: File[] }) => boolean
}

// Botón "Enviar" del modo selección: manda N archivos a otra app
// (WhatsApp, correo…) sin guardarlos en el dispositivo. Solo archivos:
// las carpetas no se pueden enviar como ficheros.
// Botón "Enviar" del modo selección: manda N archivos (de cualquier carpeta:
// la selección global se rehidrata al pulsar) a otra app (WhatsApp, correo…)
// sin guardarlos en el dispositivo. Solo archivos: las carpetas no viajan.
export default function EnviarSeleccionButton({
  ids,
}: {
  ids: string[]
}) {
  const [enviando, setEnviando] = useState(false)

  async function handleEnviar() {
    if (ids.length === 0) return
    const nav = navigator as NavigatorConShare
    if (!nav.share) {
      avisar('error', 'Este navegador no permite enviar. Descarga los archivos uno por uno.')
      return
    }
    setEnviando(true)
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
      const ficheros: File[] = []
      for (const a of archivos) {
        const res = await enviarArchivo(a.id)
        if (!('url' in res) || !res.url) {
          throw new Error(('error' in res && res.error) || `No se pudo preparar «${a.nombre_original}».`)
        }
        const r = await fetch(res.url, { credentials: 'omit' })
        if (!r.ok) throw new Error(`No se pudo obtener «${a.nombre_original}».`)
        const blob = await r.blob()
        ficheros.push(new File([blob], res.nombreOriginal ?? a.nombre_original, { type: res.tipoMime || blob.type }))
      }
      if (nav.canShare && !nav.canShare({ files: ficheros })) {
        throw new Error('no-soportado')
      }
      await nav.share({
        files: ficheros,
        title: ficheros.length === 1 ? ficheros[0].name : `${ficheros.length} archivos`,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return // menú cerrado: silencio
      avisar(
        'error',
        e instanceof Error && e.message !== 'no-soportado'
          ? e.message
          : 'Este navegador no permite enviar estos archivos. Descárgalos uno por uno.'
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={handleEnviar}
      disabled={enviando || ids.length === 0}
      style={{ minHeight: '36px' }}
      title={ids.length === 0 ? 'Selecciona archivos para enviar' : 'Enviar a otra app (WhatsApp, correo…) sin guardarlos'}
    >
      {enviando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
      {enviando ? 'Preparando…' : `Enviar a otra app (${ids.length})`}
    </button>
  )
}
