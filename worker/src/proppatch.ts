// Fase B de escritura WebDAV: PROPPATCH[displayname]. Windows y macOS usan
// esta propiedad para renombrar; el resto de propiedades (Win32LastModifiedTime,
// Win32Attributes, etc.) se rechazan con 403 sin romper el renombrado.

import { type Env, type FilaArchivo, type FilaCarpeta, type UsuarioDav } from './env'
import { archivoHijo, carpetaHija, resolver } from './arbol'
import { auditar, errorDeBd, sb } from './supabase'
import { leerCuerpoLimitado } from './escritura'
import {
  cabecerasPrivadas,
  escXml,
  hrefDe,
  nombreValido,
  responderError,
} from './util'

// Cuerpo máximo de un PROPPATCH: solo lleva nombres de propiedades.
const MAX_PROPPATCH = 64 * 1024

const ESTRUCTURALES = new Set(['propertyupdate', 'set', 'remove', 'prop', 'displayname'])

type EstadoProp = { status: number; mensaje?: string }

function desEscXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const codigo = Number.parseInt(hex, 16)
      return Number.isFinite(codigo) && codigo >= 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : ''
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const codigo = Number.parseInt(dec, 10)
      return Number.isFinite(codigo) && codigo >= 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : ''
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// Devuelve las propiedades enviadas (nombre local) menos las estructurales.
function propiedadesEnviadas(xml: string): string[] {
  const nombres = new Set<string>()
  const re = /<\s*(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (!ESTRUCTURALES.has(m[1])) nombres.add(m[1])
  }
  return [...nombres]
}

function etiquetaProp(nombre: string): string {
  const win32 = new Set([
    'Win32LastModifiedTime',
    'Win32CreationTime',
    'Win32Attributes',
    'Win32FileAttributes',
  ])
  if (win32.has(nombre)) {
    return `<Z:${nombre} xmlns:Z="urn:schemas-microsoft-com:"/>`
  }
  return `<X:${nombre} xmlns:X="urn:webdav:no-soportado"/>`
}

const TEXTO_ESTADO: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  409: 'Conflict',
  500: 'Internal Server Error',
}

function xmlProppatch(
  href: string,
  display: EstadoProp | null,
  rechazadas: string[]
): string {
  const grupos: string[] = []
  if (display) {
    grupos.push(
      '<D:propstat><D:prop><D:displayname/></D:prop>' +
        `<D:status>HTTP/1.1 ${display.status} ${TEXTO_ESTADO[display.status] ?? 'Error'}</D:status>` +
        (display.mensaje
          ? `<D:responsedescription>${escXml(display.mensaje)}</D:responsedescription>`
          : '') +
        '</D:propstat>'
    )
  }
  if (rechazadas.length > 0) {
    grupos.push(
      `<D:propstat><D:prop>${rechazadas.map(etiquetaProp).join('')}</D:prop>` +
        '<D:status>HTTP/1.1 403 Forbidden</D:status>' +
        '<D:responsedescription>Solo se admite displayname.</D:responsedescription>' +
        '</D:propstat>'
    )
  }
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escXml(href)}</D:href>` +
    grupos.join('') +
    '</D:response></D:multistatus>'
  )
}

function respuestaProppatch(body: string): Response {
  return new Response(body, {
    status: 207,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      DAV: '1',
      ...cabecerasPrivadas(),
    },
  })
}

async function estadoDeNombre(
  env: Env,
  user: UsuarioDav,
  nodo:
    | { kind: 'carpeta'; scope: 'comun' | 'privado'; carpeta: FilaCarpeta }
    | { kind: 'archivo'; scope: 'comun' | 'privado'; archivo: FilaArchivo },
  nombre: string
): Promise<EstadoProp> {
  if (nodo.kind === 'carpeta') {
    const motivo = nombreValido(nombre, true)
    if (motivo) return { status: 400, mensaje: motivo }
    const [carpetaIgual, archivoIgual] = await Promise.all([
      carpetaHija(env, user, nodo.scope, nodo.carpeta.carpeta_padre_id, nombre),
      archivoHijo(env, user, nodo.scope, nodo.carpeta.carpeta_padre_id, nombre),
    ])
    const duplicado =
      (carpetaIgual !== null && carpetaIgual.id !== nodo.carpeta.id) || archivoIgual !== null
    return duplicado
      ? { status: 409, mensaje: 'Ya existe un elemento con ese nombre en la carpeta.' }
      : { status: 200 }
  }

  const motivo = nombreValido(nombre, false)
  if (motivo) return { status: 400, mensaje: motivo }
  const [carpetaIgual, archivoIgual] = await Promise.all([
    carpetaHija(env, user, nodo.scope, nodo.archivo.carpeta_id, nombre),
    archivoHijo(env, user, nodo.scope, nodo.archivo.carpeta_id, nombre),
  ])
  const duplicado =
    (archivoIgual !== null && archivoIgual.id !== nodo.archivo.id) || carpetaIgual !== null
  return duplicado
    ? { status: 409, mensaje: 'Ya existe un elemento con ese nombre en la carpeta.' }
    : { status: 200 }
}

export async function responderProppatch(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind === 'raiz' || nodo.kind === 'ambito') {
    return responderError(403, 'Las carpetas raíz no se pueden renombrar.')
  }

  const esCarpeta = nodo.kind === 'carpeta'
  const propietario = esCarpeta ? nodo.carpeta.creado_por : nodo.archivo.subido_por
  if (propietario !== user.id && user.rol !== 'admin') {
    return responderError(
      403,
      esCarpeta
        ? 'Solo el dueño o un administrador puede renombrar esta carpeta.'
        : 'Solo el dueño o un administrador puede renombrar este archivo.'
    )
  }

  const cuerpo = await leerCuerpoLimitado(req, MAX_PROPPATCH)
  if (!cuerpo.ok) return responderError(cuerpo.status, cuerpo.error)
  const xml = await new Response(cuerpo.body).text()
  if (!xml.trim()) return responderError(400, 'PROPPATCH necesita un cuerpo XML.')

  const coincidencia = xml.match(
    /<\s*(?:[A-Za-z_][\w.-]*:)?displayname\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?displayname\s*>/i
  )
  const displayVacio =
    !coincidencia &&
    /<\s*(?:[A-Za-z_][\w.-]*:)?displayname\b[^>]*\/\s*>/i.test(xml)
  const rechazadas = propiedadesEnviadas(xml)

  let display: EstadoProp | null = null
  if (coincidencia || displayVacio) {
    const nombre = coincidencia ? desEscXml(coincidencia[1]).trim() : ''
    if (!nombre) {
      display = { status: 400, mensaje: 'El nombre no puede estar vacío.' }
    } else {
      display = await estadoDeNombre(
        env,
        user,
        nodo.kind === 'carpeta'
          ? { kind: 'carpeta', scope: nodo.scope, carpeta: nodo.carpeta }
          : { kind: 'archivo', scope: nodo.scope, archivo: nodo.archivo },
        nombre
      )

      if (display.status === 200) {
        const actual = esCarpeta ? nodo.carpeta.nombre : nodo.archivo.nombre_original
        if (nombre !== actual) {
          try {
            if (esCarpeta) {
              const filas = await sb<FilaCarpeta[]>(env, `carpetas?id=eq.${nodo.carpeta.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ nombre }),
              })
              if (filas.length !== 1) {
                display = { status: 409, mensaje: 'La carpeta cambió mientras se renombraba.' }
              } else {
                await auditar(env, user.id, 'RENOMBRAR_CARPETA', {
                  carpeta_id: nodo.carpeta.id,
                  anterior: actual,
                  nuevo: nombre,
                  via: 'webdav',
                })
              }
            } else {
              const filas = await sb<FilaArchivo[]>(
                env,
                `archivos?id=eq.${nodo.archivo.id}&estado=eq.activo`,
                {
                  method: 'PATCH',
                  headers: { Prefer: 'return=representation' },
                  body: JSON.stringify({ nombre_original: nombre }),
                }
              )
              if (filas.length !== 1) {
                display = { status: 409, mensaje: 'El archivo cambió mientras se renombraba.' }
              } else {
                await auditar(env, user.id, 'RENOMBRAR_ARCHIVO', {
                  archivo_id: nodo.archivo.id,
                  anterior: actual,
                  nuevo: nombre,
                  via: 'webdav',
                })
              }
            }
          } catch (e) {
            return errorDeBd(e)
          }
        }
      }
    }
  } else if (rechazadas.length === 0) {
    return responderError(400, 'PROPPATCH no incluye ninguna propiedad.')
  }

  const href = hrefDe(segs, esCarpeta)
  const body = xmlProppatch(href, display, rechazadas)
  return respuestaProppatch(body)
}
