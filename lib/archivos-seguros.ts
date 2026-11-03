// Utilidades de seguridad para archivos: nombres, tipos MIME y pertenencia de
// las claves de R2. Se usan en las server actions, las rutas API y el Worker
// para no repetir (ni olvidar) las mismas comprobaciones.

const MAX_NOMBRE = 200
const MAX_TIPO = 120

const TIPO_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const SEGMENTO_KEY = /^[A-Za-z0-9._-]+$/

// Nombres que se guardan en BD y se muestran en la app. Quita rutas, caracteres
// de control y comillas para que no rompan cabeceras ni la interfaz.
export function sanitizarNombreArchivo(nombre: string, maximo = MAX_NOMBRE): string {
  const base = String(nombre ?? '').split(/[\\/]/).pop() ?? ''
  const limpio = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["<>|]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
  if (!limpio || limpio === '.' || limpio === '..') return 'archivo'
  return limpio.slice(0, maximo)
}

// Los ids de Supabase son UUID. Validarlos antes de consultar evita inyecciones
// en filtros y listas enormes enviadas por el cliente.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuidValido(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor)
}

export function idsUuidValidos(valores: unknown, maximo = 200): string[] {
  if (!Array.isArray(valores)) return []
  const vistos = new Set<string>()
  for (const v of valores) {
    if (esUuidValido(v)) vistos.add(v)
    if (vistos.size >= maximo) break
  }
  return [...vistos]
}

// Variante estricta para Content-Disposition: sin comillas, barras ni CRLF.
export function nombreParaCabecera(nombre: string): string {
  return String(nombre ?? '')
    .replace(/[\u0000-\u001f\u007f"\\]/g, '_')
    .slice(0, MAX_NOMBRE) || 'archivo'
}

export function normalizarTipoMime(tipo: string | null | undefined): string {
  const limpio = String(tipo ?? '').split(';')[0].trim().toLowerCase()
  return TIPO_MIME.test(limpio) && limpio.length <= MAX_TIPO
    ? limpio
    : 'application/octet-stream'
}

// Tipos que se pueden mostrar en línea sin ejecutar contenido activo.
// SVG, HTML, XML y JavaScript se sirven como descarga: un archivo subido por un
// miembro no debe poder ejecutar scripts en el dominio de R2.
export function tipoSeguroParaInline(tipo: string | null | undefined): boolean {
  const t = normalizarTipoMime(tipo)
  const peligrosos = new Set([
    'image/svg+xml',
    'image/svg',
    'text/html',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'application/javascript',
    'text/javascript',
    'application/ecmascript',
    'text/ecmascript',
    'application/x-javascript',
  ])
  if (peligrosos.has(t)) return false
  if (t.startsWith('image/') || t.startsWith('audio/') || t.startsWith('video/')) return true
  return (
    t === 'application/pdf' ||
    t === 'text/plain' ||
    t === 'text/csv' ||
    t === 'application/json'
  )
}

// Tipo efectivo para una URL de visualización pre-firmada.
export function tipoParaVista(tipo: string | null | undefined): string {
  return tipoSeguroParaInline(tipo) ? normalizarTipoMime(tipo) : 'application/octet-stream'
}

// Comprueba que una key de R2 pertenece al usuario indicado o al Área común.
// Evita que una fila manipulada apunte a los bytes privados de otra persona.
export function keyPerteneceAUsuario(key: string, userId: string): boolean {
  if (!key || key.startsWith('/') || key.includes('\\')) return false
  const partes = key.split('/')
  if (partes.some((p) => p === '.' || p === '..' || !SEGMENTO_KEY.test(p))) return false
  if (partes[0] === 'comun') return partes.length === 2
  if (partes[0] !== 'usuarios' || partes.length !== 4) return false
  if (partes[1] !== userId || (partes[2] !== 'publico' && partes[2] !== 'privado')) return false
  return true
}

// Key temporal del Web Share Target: compartidos-pendientes/<uid>/<archivo>.
export function keyDeStagingPropia(key: string, userId: string): boolean {
  if (!key || key.startsWith('/') || key.includes('\\')) return false
  const partes = key.split('/')
  if (partes.length !== 3 || partes[0] !== 'compartidos-pendientes') return false
  if (partes[1] !== userId) return false
  return partes.every((p) => p !== '.' && p !== '..' && SEGMENTO_KEY.test(p))
}

// Una fila de `archivos` solo puede apuntar a bytes propios o del Área común.
export function keyValidaParaFila(key: string, subidoPor: string): boolean {
  return keyPerteneceAUsuario(key, subidoPor)
}
