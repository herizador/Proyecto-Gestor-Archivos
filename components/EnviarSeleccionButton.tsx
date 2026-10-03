'use client'

import { useState } from 'react'
import { Share2, Loader2 } from 'lucide-react'
import { enviarArchivo } from '@/actions/files'

const MAX_ENVIO = 10 // tope por envío: los blobs viven en memoria del móvil

type NavigatorConShare = Navigator & {
  share?: (datos: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (datos: { files: File[] }) => boolean
}

// Botón "Enviar" del modo selección: manda N archivos a otra app
// (WhatsApp, correo…) sin guardarlos en el dispositivo. Solo archivos:
// las carpetas no se pueden enviar como ficheros.
export default function EnviarSeleccionButton({
  archivos,
}: {
  archivos: Array<{ id: string; nombre: string }>
}) {
  const [enviando, setEnviando] = useState(false)

  async function handleEnviar() {
    if (archivos.length === 0) return
    if (archivos.length > MAX_ENVIO) {
      alert(`Demasiados archivos a la vez (máximo ${MAX_ENVIO}).`)
      return
    }
    const nav = navigator as NavigatorConShare
    if (!nav.share) {
      alert('Este navegador no permite enviar. Descarga los archivos uno por uno.')
      return
    }
    setEnviando(true)
    try {
      const ficheros: File[] = []
      for (const a of archivos) {
        const res = await enviarArchivo(a.id)
        if (!('url' in res) || !res.url) {
          throw new Error(('error' in res && res.error) || `No se pudo preparar «${a.nombre}».`)
        }
        const r = await fetch(res.url, { credentials: 'omit' })
        if (!r.ok) throw new Error(`No se pudo obtener «${a.nombre}».`)
        const blob = await r.blob()
        ficheros.push(new File([blob], res.nombreOriginal ?? a.nombre, { type: res.tipoMime || blob.type }))
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
      alert(
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
      disabled={enviando || archivos.length === 0}
      style={{ minHeight: '36px' }}
      title={archivos.length === 0 ? 'Selecciona archivos para enviar' : 'Enviar a otra app sin guardarlos'}
    >
      {enviando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
      {enviando ? 'Preparando…' : `Enviar (${archivos.length})`}
    </button>
  )
}
