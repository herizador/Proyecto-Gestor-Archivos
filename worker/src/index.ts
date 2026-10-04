// Puente WebDAV solo-lectura: Explorador de Windows / Finder → R2 vía Supabase.
// Solo lectura: OPTIONS, PROPFIND (depth 0/1), GET (+Range), HEAD. El resto → 501.
// Diseño completo en docs/diseno-webdav.md. Sin dependencias: solo fetch + binding R2.

interface Env {
  BUCKET: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

type FilaCarpeta = {
  id: string
  nombre: string
  carpeta_padre_id: string | null
  es_privada: boolean
  creado_por: string
  fecha_creacion: string
}

type FilaArchivo = {
  id: string
  nombre_original: string
  ruta_r2: string
  tamano_bytes: number
  tipo_mime: string
  fecha_subida: string
  carpeta_id: string | null
  subido_por: string
}

type UsuarioDav = { id: string; rol: string; tokenId: string }
type Scope = 'comun' | 'privado'

const RAIZ_COMUN = 'Área común'
const RAIZ_PRIVADA = 'Mi caja fuerte'

const SELECT_CARPETA = 'id,nombre,carpeta_padre_id,es_privada,creado_por,fecha_creacion'
const SELECT_ARCHIVO = 'id,nombre_original,ruta_r2,tamano_bytes,tipo_mime,fecha_subida,carpeta_id,subido_por'

// ---------------------------------------------------------------------------
// Supabase PostgREST con service-role (el Worker aplica la visibilidad a mano)
// ---------------------------------------------------------------------------
async function sb<T>(env: Env, recurso: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${recurso}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status} en ${recurso.split('?')[0]}`)
  return (await res.json()) as T
}

async function sha256hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hrefDe(segs: string[], esCarpeta: boolean): string {
  const base = `/${segs.map((s) => encodeURIComponent(s)).join('/')}`
  return esCarpeta && !base.endsWith('/') ? `${base}/` : base
}

function noAuth(): Response {
  return new Response('Credenciales del Explorador no válidas.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Gestor Familiar"', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

// ---------------------------------------------------------------------------
// Auth: Basic (email:token). El token es el secreto (256 bits); se valida por
// su hash en tokens_dav. El usuario del Basic se ignora en la validación.
// ---------------------------------------------------------------------------
async function autenticar(env: Env, req: Request): Promise<UsuarioDav | null> {
  const cab = req.headers.get('authorization')
  if (!cab || !cab.toLowerCase().startsWith('basic ')) return null
  let token = ''
  try {
    const decodificada = atob(cab.slice(6).trim())
    const i = decodificada.indexOf(':')
    token = i >= 0 ? decodificada.slice(i + 1) : ''
  } catch {
    return null
  }
  if (!token) return null
  const hash = await sha256hex(token)
  const toks = await sb<Array<{ id: string; usuario_id: string }>>(
    env, `tokens_dav?token_hash=eq.${hash}&revocado=eq.false&select=id,usuario_id`
  )
  if (toks.length === 0) return null
  const perf = await sb<Array<{ id: string; rol: string }>>(
    env, `perfiles?id=eq.${toks[0].usuario_id}&select=id,rol`
  )
  if (perf.length === 0) return null
  return { id: perf[0].id, rol: perf[0].rol, tokenId: toks[0].id }
}

// ---------------------------------------------------------------------------
// Árbol virtual (réplica de la visibilidad de la PWA: RLS aplicado a mano)
// ---------------------------------------------------------------------------
function filtroScope(scope: Scope, userId: string): string {
  // Privado = solo propio (igual que /mi-caja-fuerte, también para admin)
  return scope === 'comun' ? 'es_privada=eq.false' : `es_privada=eq.true&creado_por=eq.${userId}`
}

async function hijasDe(env: Env, user: UsuarioDav, scope: Scope, padre: string | null): Promise<FilaCarpeta[]> {
  const fPadre = padre ? `carpeta_padre_id=eq.${padre}` : 'carpeta_padre_id=is.null'
  return sb<FilaCarpeta[]>(
    env,
    `carpetas?select=${SELECT_CARPETA}&${filtroScope(scope, user.id)}&${fPadre}&order=fecha_creacion`
  )
}

async function archivosDe(env: Env, user: UsuarioDav, scope: Scope, padre: string | null): Promise<FilaArchivo[]> {
  const fPadre = padre ? `carpeta_id=eq.${padre}` : 'carpeta_id=is.null'
  let recurso =
    `archivos?select=${SELECT_ARCHIVO}&estado=eq.activo&${fPadre}&order=fecha_subida.desc`
  if (scope === 'privado') {
    recurso += `&subido_por=eq.${user.id}`
  }
  const filas = await sb<FilaArchivo[]>(env, recurso)
  if (scope === 'privado') {
    // Igual que /mi-caja-fuerte: la key debe declarar ámbito privado
    return filas.filter((f) => f.ruta_r2.includes('/privado/'))
  }
  return filas
}

type Nodo =
  | { kind: 'raiz' }
  | { kind: 'ambito'; scope: Scope }
  | { kind: 'carpeta'; scope: Scope; carpeta: FilaCarpeta }
  | { kind: 'archivo'; scope: Scope; archivo: FilaArchivo }

async function resolver(env: Env, user: UsuarioDav, segs: string[]): Promise<Nodo | null> {
  if (segs.length === 0) return { kind: 'raiz' }
  const [raiz, ...resto] = segs
  const scope: Scope | null = raiz === RAIZ_COMUN ? 'comun' : raiz === RAIZ_PRIVADA ? 'privado' : null
  if (!scope) return null
  let padre: string | null = null
  let carpeta: FilaCarpeta | null = null
  for (let i = 0; i < resto.length; i++) {
    const nombre = resto[i]
    const esUltimo = i === resto.length - 1
    const candidatas = await hijasDe(env, user, scope, padre)
    const coincidencia = candidatas.filter((c) => c.nombre === nombre)[0]
    if (coincidencia) {
      carpeta = coincidencia
      padre = coincidencia.id
      continue
    }
    if (esUltimo) {
      const arch = (await archivosDe(env, user, scope, padre)).filter((a) => a.nombre_original === nombre)[0]
      if (arch) return { kind: 'archivo', scope, archivo: arch }
    }
    return null
  }
  if (!carpeta) return { kind: 'ambito', scope }
  return { kind: 'carpeta', scope, carpeta }
}

function segmentos(pathname: string): string[] | null {
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

// ---------------------------------------------------------------------------
// PROPFIND → 207 Multi-Status (colecciones con trailing slash, como exige Windows)
// ---------------------------------------------------------------------------
type ItemProp = {
  href: string
  nombre: string
  esCarpeta: boolean
  tamano?: number
  tipo?: string
  fecha?: string
}

function xmlPropfind(items: ItemProp[]): string {
  const respuestas = items.map((it) => {
    const fecha = it.fecha ? new Date(it.fecha) : new Date()
    const ultimaMod = Number.isNaN(fecha.getTime()) ? new Date().toUTCString() : fecha.toUTCString()
    const creada = Number.isNaN(fecha.getTime()) ? new Date().toISOString() : fecha.toISOString()
    return (
      `<D:response><D:href>${escXml(it.href)}</D:href><D:propstat><D:prop>` +
      `<D:displayname>${escXml(it.nombre)}</D:displayname>` +
      (it.esCarpeta
        ? '<D:resourcetype><D:collection/></D:resourcetype>'
        : `<D:resourcetype/><D:getcontentlength>${it.tamano ?? 0}</D:getcontentlength>` +
          `<D:getcontenttype>${escXml(it.tipo ?? 'application/octet-stream')}</D:getcontenttype>`) +
      `<D:getlastmodified>${ultimaMod}</D:getlastmodified>` +
      `<D:creationdate>${creada}</D:creationdate>` +
      '<D:supportedlock/><D:lockdiscovery/>' +
      '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
    )
  }).join('')
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${respuestas}</D:multistatus>`
}

async function miembrosDe(
  env: Env, user: UsuarioDav, nodo: { kind: 'ambito'; scope: Scope } | { kind: 'carpeta'; scope: Scope; carpeta: FilaCarpeta }, baseSegs: string[]
): Promise<ItemProp[]> {
  const padre = nodo.kind === 'ambito' ? null : nodo.carpeta.id
  const [carpetas, archivos] = await Promise.all([
    hijasDe(env, user, nodo.scope, padre),
    archivosDe(env, user, nodo.scope, padre),
  ])
  return [
    ...carpetas.map((c): ItemProp => ({
      href: hrefDe([...baseSegs, c.nombre], true), nombre: c.nombre, esCarpeta: true, fecha: c.fecha_creacion,
    })),
    ...archivos.map((a): ItemProp => ({
      href: hrefDe([...baseSegs, a.nombre_original], false), nombre: a.nombre_original, esCarpeta: false,
      tamano: a.tamano_bytes, tipo: a.tipo_mime, fecha: a.fecha_subida,
    })),
  ]
}

async function responderPropfind(env: Env, user: UsuarioDav, req: Request, segs: string[]): Promise<Response> {
  const profundidad = (req.headers.get('depth') ?? '1').trim().toLowerCase()
  const prof: 0 | 1 = profundidad === '0' ? 0 : 1 // infinity se trata como 1
  const nodo = await resolver(env, user, segs)
  if (!nodo) return new Response('No encontrado.', { status: 404 })

  if (nodo.kind === 'archivo') {
    const a = nodo.archivo
    const item: ItemProp = {
      href: hrefDe(segs, false), nombre: a.nombre_original, esCarpeta: false,
      tamano: a.tamano_bytes, tipo: a.tipo_mime, fecha: a.fecha_subida,
    }
    return new Response(xmlPropfind([item]), {
      status: 207,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1' },
    })
  }

  const esRaiz = nodo.kind === 'raiz'
  const propio: ItemProp = esRaiz
    ? { href: '/', nombre: '', esCarpeta: true }
    : { href: hrefDe(segs, true), nombre: segs[segs.length - 1], esCarpeta: true }
  let items = [propio]
  if (prof === 1) {
    if (esRaiz) {
      items = [
        propio,
        { href: hrefDe([RAIZ_COMUN], true), nombre: RAIZ_COMUN, esCarpeta: true },
        { href: hrefDe([RAIZ_PRIVADA], true), nombre: RAIZ_PRIVADA, esCarpeta: true },
      ]
    } else {
      items = [propio, ...(await miembrosDe(env, user, nodo, segs))]
    }
  }
  return new Response(xmlPropfind(items), {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1' },
  })
}

// ---------------------------------------------------------------------------
// GET (+Range) / HEAD con streaming desde el binding R2 + auditoría best-effort
// ---------------------------------------------------------------------------
function parseRange(cab: string | null, total: number): { offset: number; length: number } | null {
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

async function marcarUsoYauditar(env: Env, user: UsuarioDav, archivo: FilaArchivo): Promise<void> {
  try {
    await Promise.all([
      sb<unknown>(env, `tokens_dav?id=eq.${user.tokenId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ ultimo_uso: new Date().toISOString() }),
      }),
      sb<unknown>(env, 'historial_actividad', {
        method: 'POST',
        body: JSON.stringify({
          usuario_id: user.id,
          accion: 'ACCESO_WEBDAV',
          detalles: { archivo_id: archivo.id, nombre_original: archivo.nombre_original, via: 'webdav' },
        }),
      }),
    ])
  } catch {
    // Best-effort: un fallo de auditoría nunca rompe la descarga
  }
}

async function responderArchivo(env: Env, user: UsuarioDav, req: Request, archivo: FilaArchivo, soloCabeceras: boolean): Promise<Response> {
  const total = archivo.tamano_bytes
  const rango = parseRange(req.headers.get('range'), total)
  const obj = await env.BUCKET.get(archivo.ruta_r2, rango ? { range: { offset: rango.offset, length: rango.length } } : undefined)
  if (!obj) return new Response('Archivo no disponible en almacenamiento.', { status: 404 })

  const cabeceras: Record<string, string> = {
    'Content-Type': archivo.tipo_mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${archivo.nombre_original.replace(/["\\]/g, '_')}"`,
  }
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

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'DAV': '1',
          'Allow': 'OPTIONS, PROPFIND, GET, HEAD',
          'MS-Author-Via': 'DAV',
          'Content-Length': '0',
        },
      })
    }

    let user: UsuarioDav | null
    try {
      user = await autenticar(env, req)
    } catch {
      return new Response('Error interno de autenticación.', { status: 500 })
    }
    if (!user) return noAuth()

    const segs = segmentos(new URL(req.url).pathname)
    if (!segs) return new Response('Ruta no válida.', { status: 400 })

    try {
      if (req.method === 'PROPFIND') return await responderPropfind(env, user, req, segs)
      if (req.method === 'GET' || req.method === 'HEAD') {
        const nodo = await resolver(env, user, segs)
        if (!nodo || nodo.kind !== 'archivo') return new Response('No encontrado.', { status: 404 })
        return await responderArchivo(env, user, req, nodo.archivo, req.method === 'HEAD')
      }
      return new Response('Método no soportado (solo lectura).', { status: 501 })
    } catch (e) {
      return new Response(`Error interno: ${e instanceof Error ? e.message : 'desconocido'}`, { status: 500 })
    }
  },
}

export default worker
