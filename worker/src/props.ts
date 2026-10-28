// PROPFIND → 207 Multi-Status (colecciones con trailing slash, como exige Windows).

import {
  RAIZ_COMUN,
  RAIZ_PRIVADA,
  type Env,
  type FilaCarpeta,
  type Scope,
  type UsuarioDav,
} from './env'
import { archivosDe, hijasDe, resolver } from './arbol'
import { usoAlmacenamiento } from './supabase'
import { cabecerasPrivadas, escXml, etagDe, hrefDe } from './util'

export type ItemProp = {
  href: string
  nombre: string
  esCarpeta: boolean
  tamano?: number
  tipo?: string
  fecha?: string
  etag?: string
  cuota?: { usada: number; libre: number } | null
}

export function xmlPropfind(items: ItemProp[]): string {
  const respuestas = items
    .map((it) => {
      const fecha = it.fecha ? new Date(it.fecha) : new Date()
      const ultimaMod = Number.isNaN(fecha.getTime())
        ? new Date().toUTCString()
        : fecha.toUTCString()
      const creada = Number.isNaN(fecha.getTime()) ? new Date().toISOString() : fecha.toISOString()
      return (
        `<D:response><D:href>${escXml(it.href)}</D:href><D:propstat><D:prop>` +
        `<D:displayname>${escXml(it.nombre)}</D:displayname>` +
        (it.esCarpeta
          ? '<D:resourcetype><D:collection/></D:resourcetype>'
          : `<D:resourcetype/><D:getcontentlength>${it.tamano ?? 0}</D:getcontentlength>` +
            `<D:getcontenttype>${escXml(it.tipo ?? 'application/octet-stream')}</D:getcontenttype>` +
            (it.etag ? `<D:getetag>${escXml(it.etag)}</D:getetag>` : '')) +
        `<D:getlastmodified>${ultimaMod}</D:getlastmodified>` +
        `<D:creationdate>${creada}</D:creationdate>` +
        (it.esCarpeta && it.cuota
          ? `<D:quota-available-bytes>${it.cuota.libre}</D:quota-available-bytes>` +
            `<D:quota-used-bytes>${it.cuota.usada}</D:quota-used-bytes>`
          : '') +
        '<D:supportedlock/><D:lockdiscovery/>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
      )
    })
    .join('')
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${respuestas}</D:multistatus>`
}

export async function miembrosDe(
  env: Env,
  user: UsuarioDav,
  nodo: { kind: 'ambito'; scope: Scope } | { kind: 'carpeta'; scope: Scope; carpeta: FilaCarpeta },
  baseSegs: string[],
  cuota: { usada: number; libre: number } | null
): Promise<ItemProp[]> {
  const padre = nodo.kind === 'ambito' ? null : nodo.carpeta.id
  const [carpetas, archivos] = await Promise.all([
    hijasDe(env, user, nodo.scope, padre),
    archivosDe(env, user, nodo.scope, padre),
  ])
  return [
    ...carpetas.map(
      (c): ItemProp => ({
        href: hrefDe([...baseSegs, c.nombre], true),
        nombre: c.nombre,
        esCarpeta: true,
        fecha: c.fecha_creacion,
        cuota,
      })
    ),
    ...archivos.map(
      (a): ItemProp => ({
        href: hrefDe([...baseSegs, a.nombre_original], false),
        nombre: a.nombre_original,
        esCarpeta: false,
        tamano: a.tamano_bytes,
        tipo: a.tipo_mime,
        fecha: a.fecha_subida,
        etag: etagDe(a),
      })
    ),
  ]
}

export async function responderPropfind(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const profundidad = (req.headers.get('depth') ?? '1').trim().toLowerCase()
  const prof: 0 | 1 = profundidad === '0' ? 0 : 1 // infinity se trata como 1
  const nodo = await resolver(env, user, segs)
  if (!nodo) return new Response('No encontrado.', { status: 404 })

  if (nodo.kind === 'archivo') {
    const a = nodo.archivo
    const item: ItemProp = {
      href: hrefDe(segs, false),
      nombre: a.nombre_original,
      esCarpeta: false,
      tamano: a.tamano_bytes,
      tipo: a.tipo_mime,
      fecha: a.fecha_subida,
      etag: etagDe(a),
    }
    return new Response(xmlPropfind([item]), {
      status: 207,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        DAV: '1',
        ...cabecerasPrivadas(),
      },
    })
  }

  const esRaiz = nodo.kind === 'raiz'
  const cuota = await usoAlmacenamiento(env)
  const propio: ItemProp = esRaiz
    ? { href: '/', nombre: '', esCarpeta: true, cuota }
    : { href: hrefDe(segs, true), nombre: segs[segs.length - 1], esCarpeta: true, cuota }
  let items = [propio]
  if (prof === 1) {
    if (esRaiz) {
      items = [
        propio,
        { href: hrefDe([RAIZ_COMUN], true), nombre: RAIZ_COMUN, esCarpeta: true, cuota },
        { href: hrefDe([RAIZ_PRIVADA], true), nombre: RAIZ_PRIVADA, esCarpeta: true, cuota },
      ]
    } else {
      items = [propio, ...(await miembrosDe(env, user, nodo, segs, cuota))]
    }
  }
  return new Response(xmlPropfind(items), {
    status: 207,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      DAV: '1',
      ...cabecerasPrivadas(),
    },
  })
}
