// Puente WebDAV: Explorador de Windows / Finder → R2 vía Supabase.
// Lectura: OPTIONS, PROPFIND (depth 0/1), GET (+Range), HEAD.
// Escritura (Fases A y B, tras DAV_WRITE): PUT, MKCOL, DELETE, MOVE, COPY y
// PROPPATCH[displayname]. Diseño en docs/diseno/webdav.md y webdav-escritura.md.
// Sin dependencias: solo fetch + binding R2.

import { MAX_SEGMENTOS, type Env, type UsuarioDav } from './env'
import { autenticar, tocarToken } from './supabase'
import { resolver } from './arbol'
import { responderArchivo } from './lectura'
import { responderPropfind } from './props'
import { responderDelete, responderMkcol, responderPut } from './escritura'
import { responderCopy, responderMove } from './mover'
import { responderProppatch } from './proppatch'
import { cabecerasPrivadas, noAuth, responderError, segmentos } from './util'

// Rate-limit best-effort en memoria del isolate (sin infra extra). Cada
// isolate lleva su contador; con dominio propio se puede sumar una regla.
const VENTANA_MS = 60_000
const MAX_POR_IP = 30 // sin autenticar (por IP vista por Cloudflare)
const MAX_POR_TOKEN = 300 // autenticado (por token)
const MAX_ESCRITURA_POR_TOKEN = 60 // PUT/MKCOL/DELETE/MOVE/COPY/PROPPATCH por minuto
const marcasRitmo = new Map<string, number[]>()

function excesoRitmo(clave: string, maximo: number): boolean {
  const ahora = Date.now()
  const marcas = (marcasRitmo.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS)
  marcas.push(ahora)
  marcasRitmo.set(clave, marcas)
  if (marcasRitmo.size > 2000) {
    for (const [k, m] of marcasRitmo) {
      if (m.length === 0 || ahora - m[m.length - 1] > VENTANA_MS) marcasRitmo.delete(k)
      if (marcasRitmo.size <= 1000) break
    }
  }
  return marcas.length > maximo
}

type ModoEscritura = 'off' | 'admin' | 'all'

function modoEscritura(env: Env): ModoEscritura {
  const valor = (env.DAV_WRITE ?? '0').trim().toLowerCase()
  if (valor === 'all' || valor === '1' || valor === 'true') return 'all'
  if (valor === 'admin') return 'admin'
  return 'off'
}

function metodosPermitidos(env: Env): string {
  const lectura = 'OPTIONS, PROPFIND, GET, HEAD'
  return modoEscritura(env) === 'off'
    ? lectura
    : `${lectura}, PUT, MKCOL, DELETE, MOVE, COPY, PROPPATCH`
}

const METODOS_ESCRITURA = new Set([
  'PUT',
  'MKCOL',
  'DELETE',
  'MOVE',
  'COPY',
  'PROPPATCH',
  'LOCK',
  'UNLOCK',
])

// `ultimo_uso` se actualiza también al escribir, no solo al abrir archivos.
async function trasEscribir(env: Env, user: UsuarioDav, res: Response): Promise<Response> {
  if (res.status < 300) await tocarToken(env, user.tokenId)
  return res
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          DAV: '1',
          Allow: metodosPermitidos(env),
          'MS-Author-Via': 'DAV',
          'Content-Length': '0',
          ...cabecerasPrivadas(),
        },
      })
    }

    // Pre-chequeo por IP antes de tocar la BD (frena fuerza bruta anónima)
    const ip = req.headers.get('cf-connecting-ip') ?? 'desconocida'
    if (excesoRitmo(`ip:${ip}`, MAX_POR_IP)) {
      return responderError(429, 'Demasiadas peticiones.', { 'Retry-After': '60' })
    }

    let user: Awaited<ReturnType<typeof autenticar>>
    try {
      user = await autenticar(env, req)
    } catch {
      return responderError(500, 'Error interno de autenticación.')
    }
    if (!user) return noAuth()
    if (excesoRitmo(`tok:${user.tokenId}`, MAX_POR_TOKEN)) {
      return responderError(429, 'Demasiadas peticiones.', { 'Retry-After': '60' })
    }

    const segs = segmentos(new URL(req.url).pathname)
    if (!segs) return responderError(400, 'Ruta no válida.')
    if (segs.length > MAX_SEGMENTOS) {
      return responderError(400, 'Ruta demasiado profunda.')
    }

    const esEscritura = METODOS_ESCRITURA.has(req.method)
    if (esEscritura) {
      const modo = modoEscritura(env)
      if (modo === 'off') {
        return responderError(
          501,
          'La escritura WebDAV está desactivada (DAV_WRITE=0). Los archivos se gestionan desde la app.',
          { Allow: metodosPermitidos(env) }
        )
      }
      if (modo === 'admin' && user.rol !== 'admin') {
        return responderError(
          403,
          'La escritura desde el Explorador está en pruebas: solo el administrador puede usarla.'
        )
      }
      if (excesoRitmo(`esc:${user.tokenId}`, MAX_ESCRITURA_POR_TOKEN)) {
        return responderError(429, 'Demasiadas escrituras seguidas.', { 'Retry-After': '60' })
      }
    }

    try {
      if (req.method === 'PROPFIND') return await responderPropfind(env, user, req, segs)
      if (req.method === 'GET' || req.method === 'HEAD') {
        const nodo = await resolver(env, user, segs)
        if (!nodo || nodo.kind !== 'archivo') {
          return responderError(404, 'No encontrado.')
        }
        return await responderArchivo(env, user, req, nodo.archivo, req.method === 'HEAD')
      }
      if (req.method === 'PUT') {
        return await trasEscribir(env, user, await responderPut(env, user, req, segs))
      }
      if (req.method === 'MKCOL') {
        return await trasEscribir(env, user, await responderMkcol(env, user, req, segs))
      }
      if (req.method === 'DELETE') {
        return await trasEscribir(env, user, await responderDelete(env, user, segs))
      }
      if (req.method === 'MOVE') {
        return await trasEscribir(env, user, await responderMove(env, user, req, segs))
      }
      if (req.method === 'COPY') {
        return await trasEscribir(env, user, await responderCopy(env, user, req, segs))
      }
      if (req.method === 'PROPPATCH') {
        return await trasEscribir(env, user, await responderProppatch(env, user, req, segs))
      }
      if (esEscritura) {
        return responderError(501, `${req.method} todavía no está disponible.`, {
          Allow: metodosPermitidos(env),
        })
      }
      return responderError(501, 'Método no soportado.', { Allow: metodosPermitidos(env) })
    } catch (e) {
      console.error('WebDAV:', e)
      return responderError(500, 'Error interno del puente WebDAV.')
    }
  },
}

export default worker
