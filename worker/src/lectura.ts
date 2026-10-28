// GET (+Range) / HEAD con streaming desde el binding R2 + auditoría best-effort.

import type { Env, FilaArchivo, UsuarioDav } from './env'
import { auditar, tocarToken } from './supabase'
import { cabecerasPrivadas, etagDe } from './util'

function parseRange(
  cab: string | null,
  total: number
): { offset: number; length: number } | null {
  if (!cab) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(cab.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {
    const suf = Number(b)
    if (!Number.isFinite(suf) || suf <= 0) return null
    const len = Math.min(suf, total)
    return { offset: total - len, length: len }
  }
  const offset = Number(a)
  if (!Number.isFinite(offset) || offset >= total) return null
  const fin = b === '' ? total - 1 : Math.min(Number(b), total - 1)
  if (fin < offset) return null
  return { offset, length: fin - offset + 1 }
}

async function marcarUsoYauditar(
  env: Env,
  user: UsuarioDav,
  archivo: FilaArchivo
): Promise<void> {
  try {
    await Promise.all([
      tocarToken(env, user.tokenId),
      auditar(env, user.id, 'ACCESO_WEBDAV', {
        archivo_id: archivo.id,
        nombre_original: archivo.nombre_original,
        via: 'webdav',
      }),
    ])
  } catch {
    // Best-effort: un fallo de auditoría nunca rompe la descarga
  }
}

export async function responderArchivo(
  env: Env,
  user: UsuarioDav,
  req: Request,
  archivo: FilaArchivo,
  soloCabeceras: boolean
): Promise<Response> {
  const total = archivo.tamano_bytes
  const etag = etagDe(archivo)
  const fecha = new Date(archivo.fecha_subida)
  const cabeceras: Record<string, string> = {
    'Content-Type': archivo.tipo_mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${archivo.nombre_original.replace(/["\\]/g, '_')}"`,
    ETag: etag,
    ...(Number.isNaN(fecha.getTime()) ? {} : { 'Last-Modified': fecha.toUTCString() }),
    ...cabecerasPrivadas(),
  }

  // Si el cliente ya tiene esta versión, no se envían bytes.
  const ifNone = req.headers.get('if-none-match')
  if (ifNone) {
    const etiquetas = ifNone.split(',').map((t) => t.trim())
    if (etiquetas.includes('*') || etiquetas.includes(etag)) {
      return new Response(null, { status: 304, headers: cabeceras })
    }
  }

  const rango = parseRange(req.headers.get('range'), total)
  const obj = await env.BUCKET.get(
    archivo.ruta_r2,
    rango ? { range: { offset: rango.offset, length: rango.length } } : undefined
  )
  if (!obj) return new Response('Archivo no disponible en almacenamiento.', { status: 404 })

  let estado = 200
  if (rango) {
    estado = 206
    cabeceras['Content-Range'] = `bytes ${rango.offset}-${rango.offset + rango.length - 1}/${total}`
    cabeceras['Content-Length'] = String(rango.length)
  } else {
    cabeceras['Content-Length'] = String(obj.size)
  }

  if (!soloCabeceras) {
    await marcarUsoYauditar(env, user, archivo)
    return new Response(obj.body, { status: estado, headers: cabeceras })
  }
  return new Response(null, { status: estado, headers: cabeceras })
}
