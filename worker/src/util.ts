// Utilidades sin estado: cabeceras, nombres, rutas, MIME y ETag.

import type { Scope } from './env'

// Nada del puente se cachea: son listados privados por token
export function cabecerasPrivadas(extra?: Record<string, string>): Record<string, string> {
  return { 'Cache-Control': 'no-store, no-cache, must-revalidate', ...(extra ?? {}) }
}

export function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function hrefDe(segs: string[], esCarpeta: boolean): string {
  const base = `/${segs.map((s) => encodeURIComponent(s)).join('/')}`
  return esCarpeta && !base.endsWith('/') ? `${base}/` : base
}

export function noAuth(): Response {
  return new Response('Credenciales del Explorador no válidas.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Gestor Familiar"',
      'Content-Type': 'text/plain; charset=utf-8',
      ...cabecerasPrivadas(),
    },
  })
}

export function responderError(
  status: number,
  texto: string,
  extra?: Record<string, string>
): Response {
  return new Response(texto, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cabecerasPrivadas(extra) },
  })
}

export function segmentos(pathname: string): string[] | null {
  const partes = pathname.split('/').filter((p) => p.length > 0)
  const decodificadas: string[] = []
  for (const p of partes) {
    try {
      decodificadas.push(decodeURIComponent(p))
    } catch {
      return null
    }
  }
  return decodificadas
}

// ETag débil basado en tamaño + fecha de subida. No cambia al renombrar (los
// bytes y la fecha son los mismos); sí al sobrescribir.
export function etagDe(archivo: { tamano_bytes: number; fecha_subida: string }): string {
  const t = new Date(archivo.fecha_subida).getTime()
  return `"${archivo.tamano_bytes}-${Number.isFinite(t) ? t : 0}"`
}

const MIME_POR_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  md: 'text/markdown',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
}

export function mimePorExtension(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  const ext = punto >= 0 ? nombre.slice(punto + 1).toLowerCase() : ''
  return MIME_POR_EXTENSION[ext] ?? 'application/octet-stream'
}

// Los navegadores y Windows suelen mandar application/octet-stream para todo;
// en ese caso manda la extensión. Si el cliente da un tipo concreto, se respeta.
export function mimeEfectivo(nombre: string, contentType: string | null): string {
  const limpio = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (limpio && limpio !== 'application/octet-stream' && limpio !== 'binary/octet-stream') {
    return (contentType ?? '').trim()
  }
  return mimePorExtension(nombre)
}

const RESERVADOS_WINDOWS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

// Basura típica de Office, Windows y macOS. No se sube ni se audita.
export function esBasura(nombre: string): boolean {
  const n = nombre.toLowerCase()
  return (
    n.startsWith('~$') ||
    n.startsWith('.~lock.') ||
    n.endsWith('.tmp') ||
    n.endsWith('.lock') ||
    n === '.ds_store' ||
    n === 'desktop.ini' ||
    n === 'thumbs.db' ||
    n === '.spotlight-v100'
  )
}

// Devuelve el motivo del rechazo o null si el nombre es aceptable.
export function nombreValido(nombre: string, esCarpeta: boolean): string | null {
  const maximo = esCarpeta ? 100 : 200
  if (!nombre) return 'El nombre está vacío.'
  if (nombre.length > maximo) {
    return `El nombre supera los ${maximo} caracteres.`
  }
  if (nombre === '.' || nombre === '..') return 'Ese nombre no es válido.'
  if (/[/\\]/.test(nombre)) return 'El nombre no puede contener barras.'
  if (/[\u0000-\u001f\u007f]/.test(nombre)) return 'El nombre contiene caracteres de control.'
  if (/[. ]$/.test(nombre)) return 'El nombre no puede terminar en punto o espacio.'
  const base = nombre.split('.')[0].toUpperCase()
  if (RESERVADOS_WINDOWS.has(base)) return 'Ese nombre está reservado por Windows.'
  if (esBasura(nombre)) return 'No se aceptan archivos temporales ni basura del sistema.'
  return null
}

function sufijoAleatorio(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Key de R2 equivalente a buildR2Key(): prefijo por ámbito y nombre saneado.
// El sufijo aleatorio evita que dos subidas con el mismo nombre en el mismo
// milisegundo compartan key. Las sobrescrituras usan una key nueva (swap).
export function keyNueva(userId: string, scope: Scope, nombre: string): string {
  const safeName = nombre.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const sello = `${Date.now()}_${sufijoAleatorio()}`
  return scope === 'comun'
    ? `comun/${sello}_${safeName}`
    : `usuarios/${userId}/privado/${sello}_${safeName}`
}
