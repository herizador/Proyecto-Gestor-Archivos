// Fase C: WebDAV Clase 2 (LOCK/UNLOCK). Un bloqueo exclusivo de escritura por
// recurso, con expiración y token opaquelocktoken. La tabla locks_dav solo la
// toca el Worker con service-role; la PWA no la necesita.
// Diseño en docs/diseno/webdav-escritura.md §6 y §12.5.

import { type Env, type UsuarioDav } from './env'
import { resolver } from './arbol'
import { ErrorSupabase, sb, sbVoid, errorDeBd } from './supabase'
import {
  cabecerasPrivadas,
  claseDav,
  desEscXml,
  escXml,
  hrefDe,
  leerCuerpoLimitado,
  responderError,
} from './util'

export type FilaLock = {
  id: string
  recurso_id: string
  es_carpeta: boolean
  profundidad: '0' | 'infinity'
  usuario_id: string
  propietario: string
  token: string
  expira: string
  fecha_creacion: string
}

// Recurso sobre el que se comprueba un bloqueo. `id` es el archivo/carpeta
// concreto (null si aún no existe, p. ej. un PUT nuevo); `padreId` es la
// carpeta que lo contiene. Para una carpeta, sus ancestros se obtienen de la
// propia cadena de padres.
export type RecursoBloqueo = {
  id: string | null
  esCarpeta: boolean
  padreId: string | null
}

const SELECT_LOCK =
  'id,recurso_id,es_carpeta,profundidad,usuario_id,propietario,token,expira,fecha_creacion'
const MAX_LOCKINFO = 64 * 1024
const TIMEOUT_DEFECTO = 3600
const TIMEOUT_MAX = 86400

function ahoraIso(): string {
  return new Date().toISOString()
}

function normalizarToken(token: string): string {
  return token.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
}

// Extrae los tokens de las cabeceras If y Lock-Token. Se descartan los tokens
// negados con Not (If: (Not <token>)), que no autorizan la escritura.
export function tokensDePeticion(req: Request): Set<string> {
  const tokens = new Set<string>()
  for (const cabecera of [req.headers.get('if'), req.headers.get('lock-token')]) {
    if (!cabecera) continue
    const sinNegados = cabecera.replace(/\bNot\s*<[^>]*>/gi, '')
    for (const match of sinNegados.match(/(?:opaquelocktoken|urn:uuid):[^>\s,)]+/gi) ?? []) {
      tokens.add(normalizarToken(match))
    }
  }
  return tokens
}

// Timeout: Second-N (defecto 3600, tope 24 h) o Infinite.
export function timeoutDe(req: Request): number {
  const cabecera = req.headers.get('timeout')
  if (!cabecera) return TIMEOUT_DEFECTO
  for (const parte of cabecera.split(',')) {
    const valor = parte.trim()
    const match = /^Second-(\d+)$/i.exec(valor)
    if (match) {
      const segundos = Number(match[1])
      if (Number.isFinite(segundos)) {
        return Math.min(TIMEOUT_MAX, Math.max(1, Math.trunc(segundos)))
      }
    }
    if (/^Infinite$/i.test(valor)) return TIMEOUT_MAX
  }
  return TIMEOUT_DEFECTO
}

function tablaAusente(e: unknown): boolean {
  return (
    e instanceof ErrorSupabase &&
    (e.status === 404 || e.cuerpo.includes('42P01') || e.cuerpo.includes('PGRST205'))
  )
}

function respuestaTablaAusente(): Response {
  return responderError(
    500,
    'Falta aplicar la migración locks_dav en Supabase (SQL Editor).'
  )
}

// Consulta tolerante: si la migración aún no se aplicó, la lectura sigue
// funcionando sin locks en vez de romper todo el PROPFIND.
async function locksActivos(env: Env, ids: string[]): Promise<FilaLock[]> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))]
  if (unicos.length === 0) return []
  try {
    return await sb<FilaLock[]>(
      env,
      `locks_dav?select=${SELECT_LOCK}&recurso_id=in.(${unicos.join(',')})&expira=gt.${encodeURIComponent(ahoraIso())}`
    )
  } catch (e) {
    if (tablaAusente(e)) return []
    throw e
  }
}

// Limpieza oportunista: se llama en LOCK/UNLOCK, no en cada escritura.
async function limpiarExpirados(env: Env): Promise<void> {
  try {
    await sbVoid(env, `locks_dav?expira=lte.${encodeURIComponent(ahoraIso())}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch {
    // Best-effort: los caducados se ignoran igualmente con expira=gt.
  }
}

async function idsPadres(env: Env, carpetaId: string | null): Promise<string[]> {
  const ids: string[] = []
  let cursor = carpetaId
  for (let i = 0; i < 50 && cursor; i++) {
    ids.push(cursor)
    const filas = await sb<Array<{ carpeta_padre_id: string | null }>>(
      env,
      `carpetas?id=eq.${encodeURIComponent(cursor)}&select=carpeta_padre_id`
    )
    cursor = filas[0]?.carpeta_padre_id ?? null
  }
  return ids
}

async function idsDeRecurso(
  env: Env,
  recurso: RecursoBloqueo
): Promise<{ directo: string | null; ancestros: string[] }> {
  if (recurso.id) {
    if (recurso.esCarpeta) {
      const cadena = await idsPadres(env, recurso.id)
      return { directo: recurso.id, ancestros: cadena.slice(1) }
    }
    const ancestros = recurso.padreId ? await idsPadres(env, recurso.padreId) : []
    return { directo: recurso.id, ancestros }
  }
  if (recurso.padreId) {
    // Recurso nuevo: el padre se considera directo (un lock Depth:0 de la
    // carpeta también impide crear hijos) y el resto son ancestros.
    const cadena = await idsPadres(env, recurso.padreId)
    return { directo: cadena[0] ?? null, ancestros: cadena.slice(1) }
  }
  return { directo: null, ancestros: [] }
}

function aplicaAlRecurso(
  lock: FilaLock,
  directo: string | null,
  ancestros: string[]
): boolean {
  if (directo && lock.recurso_id === directo) return true
  return (
    lock.es_carpeta &&
    lock.profundidad === 'infinity' &&
    ancestros.includes(lock.recurso_id)
  )
}

function respuestaBloqueada(lock: FilaLock): Response {
  // No se devuelve el token: permitiría a cualquiera saltarse el bloqueo.
  const quien = lock.propietario ? ` por ${lock.propietario}` : ''
  return responderError(
    423,
    `El recurso está bloqueado${quien}. Espera a que se libere o pide al propietario que cierre el archivo.`
  )
}

// Devuelve 423 si algún recurso está bloqueado y la petición no trae su token.
export async function comprobarBloqueo(
  env: Env,
  req: Request,
  recursos: RecursoBloqueo[]
): Promise<Response | null> {
  const tokens = tokensDePeticion(req)
  const resueltos = await Promise.all(
    recursos.map(async (recurso) => ({ ...(await idsDeRecurso(env, recurso)) }))
  )
  const ids = [
    ...new Set(
      resueltos.flatMap(({ directo, ancestros }) => [
        ...(directo ? [directo] : []),
        ...ancestros,
      ])
    ),
  ]
  const locks = await locksActivos(env, ids)
  for (const { directo, ancestros } of resueltos) {
    for (const lock of locks) {
      if (!aplicaAlRecurso(lock, directo, ancestros)) continue
      if (!tokens.has(lock.token)) return respuestaBloqueada(lock)
    }
  }
  return null
}

// Locks directos de varios recursos, para pintar lockdiscovery en PROPFIND.
// Se consulta en tandas de 100 para no superar el largo máximo de URL cuando
// una carpeta tiene muchos hijos.
export async function locksDeRecursos(
  env: Env,
  ids: string[]
): Promise<Map<string, FilaLock[]>> {
  const mapa = new Map<string, FilaLock[]>()
  const unicos = [...new Set(ids.filter((id): id is string => !!id))]
  for (let i = 0; i < unicos.length; i += 100) {
    const filas = await locksActivos(env, unicos.slice(i, i + 100))
    for (const fila of filas) {
      const lista = mapa.get(fila.recurso_id) ?? []
      lista.push(fila)
      mapa.set(fila.recurso_id, lista)
    }
  }
  return mapa
}

export function xmlSupportedLock(): string {
  return (
    '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope>' +
    '<D:locktype><D:write/></D:locktype></D:lockentry>'
  )
}

function segundosRestantes(expira: string): number {
  const t = new Date(expira).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : 0
}

export function xmlActivelock(lock: FilaLock, href: string): string {
  return (
    '<D:activelock>' +
    '<D:locktype><D:write/></D:locktype>' +
    '<D:lockscope><D:exclusive/></D:lockscope>' +
    `<D:depth>${lock.profundidad}</D:depth>` +
    (lock.propietario ? `<D:owner>${escXml(lock.propietario)}</D:owner>` : '') +
    `<D:timeout>Second-${segundosRestantes(lock.expira)}</D:timeout>` +
    `<D:locktoken><D:href>${escXml(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${escXml(href)}</D:href></D:lockroot>` +
    '</D:activelock>'
  )
}

function respuestaActivelock(env: Env, lock: FilaLock, href: string): Response {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<D:prop xmlns:D="DAV:"><D:lockdiscovery>' +
    xmlActivelock(lock, href) +
    '</D:lockdiscovery></D:prop>'
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<${lock.token}>`,
      Timeout: `Second-${segundosRestantes(lock.expira)}`,
      DAV: claseDav(env),
      ...cabecerasPrivadas(),
    },
  })
}

function extraerOwner(xml: string): string {
  const match = xml.match(
    /<\s*(?:[A-Za-z_][\w.-]*:)?owner\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?owner\s*>/i
  )
  if (!match) return ''
  return desEscXml(match[1].replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255)
}

async function crearLock(
  env: Env,
  user: UsuarioDav,
  recursoId: string,
  esCarpeta: boolean,
  profundidad: '0' | 'infinity',
  propietario: string,
  expira: string
): Promise<FilaLock> {
  const token = `opaquelocktoken:${crypto.randomUUID()}`
  const filas = await sb<FilaLock[]>(env, 'locks_dav', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      recurso_id: recursoId,
      es_carpeta: esCarpeta,
      profundidad,
      usuario_id: user.id,
      propietario,
      token,
      expira,
    }),
  })
  if (filas.length !== 1) {
    throw new Error('No se pudo crear el bloqueo.')
  }
  return filas[0]
}

async function renovarLock(
  env: Env,
  lock: FilaLock,
  expira: string
): Promise<FilaLock> {
  const filas = await sb<FilaLock[]>(env, `locks_dav?id=eq.${lock.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ expira }),
  })
  if (filas.length !== 1) {
    throw new Error('El bloqueo cambió mientras se renovaba.')
  }
  return filas[0]
}

// ---------------------------------------------------------------------------
// LOCK: crear un bloqueo exclusivo o refrescar uno existente.
// ---------------------------------------------------------------------------
export async function responderLock(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind === 'raiz' || nodo.kind === 'ambito') {
    return responderError(403, 'Las carpetas raíz no se pueden bloquear.')
  }

  const esCarpeta = nodo.kind === 'carpeta'
  const propietarioRecurso = esCarpeta
    ? nodo.carpeta.creado_por
    : nodo.archivo.subido_por
  if (propietarioRecurso !== user.id && user.rol !== 'admin') {
    return responderError(
      403,
      esCarpeta
        ? 'Solo el dueño o un administrador puede bloquear esta carpeta.'
        : 'Solo el dueño o un administrador puede bloquear este archivo.'
    )
  }

  const recursoId = esCarpeta ? nodo.carpeta.id : nodo.archivo.id
  const padreId = esCarpeta ? null : nodo.archivo.carpeta_id
  const href = hrefDe(segs, esCarpeta)
  const timeout = timeoutDe(req)
  const expira = new Date(Date.now() + timeout * 1000).toISOString()

  await limpiarExpirados(env)

  const { ancestros } = await idsDeRecurso(env, {
    id: recursoId,
    esCarpeta,
    padreId,
  })
  const locks = await locksActivos(env, [recursoId, ...ancestros])
  const directo = locks.find((l) => l.recurso_id === recursoId) ?? null
  const ancestro = locks.find(
    (l) =>
      l.recurso_id !== recursoId &&
      l.es_carpeta &&
      l.profundidad === 'infinity'
  )
  // No se anidan bloqueos: un lock de carpeta ya protege a sus hijos.
  if (ancestro) {
    return responderError(
      423,
      'Hay un bloqueo activo en una carpeta superior. Cierra el archivo o espera a que expire.'
    )
  }

  const cuerpo = await leerCuerpoLimitado(
    req,
    MAX_LOCKINFO,
    'El lockinfo supera el límite de 64 KB.'
  )
  if (!cuerpo.ok) return responderError(cuerpo.status, cuerpo.error)
  const xml = await new Response(cuerpo.body).text()
  const esRefresco = xml.trim() === ''
  const tokens = tokensDePeticion(req)

  try {
    if (directo) {
      const mismoDueno = directo.usuario_id === user.id || user.rol === 'admin'
      if (esRefresco) {
        if (!mismoDueno || !tokens.has(directo.token)) {
          return respuestaBloqueada(directo)
        }
        return respuestaActivelock(env, await renovarLock(env, directo, expira), href)
      }
      if (!mismoDueno) return respuestaBloqueada(directo)
      // Mismo usuario: si trae el token, renueva; si no (p. ej. Office se
      // reinició), reemplaza su propio bloqueo para poder recuperarse.
      if (tokens.has(directo.token)) {
        return respuestaActivelock(env, await renovarLock(env, directo, expira), href)
      }
      await sbVoid(env, `locks_dav?id=eq.${directo.id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    } else if (esRefresco) {
      return responderError(412, 'No hay ningún bloqueo que refrescar en este recurso.')
    }

    if (!esRefresco) {
      if (!/<\s*(?:[A-Za-z_][\w.-]*:)?lockinfo\b/i.test(xml)) {
        return responderError(400, 'El cuerpo de LOCK debe ser un lockinfo.')
      }
      if (/<\s*(?:[A-Za-z_][\w.-]*:)?shared\b/i.test(xml)) {
        return responderError(403, 'Solo se admiten bloqueos exclusivos.')
      }
      if (
        /<\s*(?:[A-Za-z_][\w.-]*:)?locktype\b/i.test(xml) &&
        !/<\s*(?:[A-Za-z_][\w.-]*:)?write\b/i.test(xml)
      ) {
        return responderError(400, 'Solo se admiten bloqueos de escritura.')
      }
    }

    const profundidad: '0' | 'infinity' =
      esCarpeta && (req.headers.get('depth') ?? '').trim() !== '0' ? 'infinity' : '0'
    const lock = await crearLock(
      env,
      user,
      recursoId,
      esCarpeta,
      profundidad,
      extraerOwner(xml) || user.id,
      expira
    )
    return respuestaActivelock(env, lock, href)
  } catch (e) {
    if (tablaAusente(e)) return respuestaTablaAusente()
    if (e instanceof ErrorSupabase && (e.status === 409 || e.cuerpo.includes('23505'))) {
      return responderError(
        423,
        'El recurso acaba de ser bloqueado por otra sesión. Vuelve a abrirlo en unos segundos.'
      )
    }
    if (e instanceof Error && e.message.startsWith('No se pudo')) {
      return responderError(500, e.message)
    }
    if (e instanceof Error && e.message.startsWith('El bloqueo cambió')) {
      return responderError(409, e.message)
    }
    return errorDeBd(e)
  }
}

// ---------------------------------------------------------------------------
// UNLOCK: exige el Lock-Token exacto del recurso y lo elimina.
// ---------------------------------------------------------------------------
export async function responderUnlock(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind === 'raiz' || nodo.kind === 'ambito') {
    return responderError(403, 'Las carpetas raíz no tienen bloqueos.')
  }

  const esCarpeta = nodo.kind === 'carpeta'
  const propietarioRecurso = esCarpeta
    ? nodo.carpeta.creado_por
    : nodo.archivo.subido_por
  if (propietarioRecurso !== user.id && user.rol !== 'admin') {
    return responderError(403, 'Solo el dueño o un administrador puede desbloquear este recurso.')
  }

  const recursoId = esCarpeta ? nodo.carpeta.id : nodo.archivo.id
  const cabecera = req.headers.get('lock-token')
  const tokens = tokensDePeticion(req)
  const token = cabecera ? normalizarToken(cabecera) : ([...tokens][0] ?? '')
  if (!token) return responderError(400, 'Falta la cabecera Lock-Token.')

  await limpiarExpirados(env)

  let locks: FilaLock[]
  try {
    locks = await sb<FilaLock[]>(
      env,
      `locks_dav?select=${SELECT_LOCK}&recurso_id=eq.${recursoId}&token=eq.${encodeURIComponent(token)}&expira=gt.${encodeURIComponent(ahoraIso())}`
    )
  } catch (e) {
    if (tablaAusente(e)) return respuestaTablaAusente()
    return errorDeBd(e)
  }

  if (locks.length === 0) {
    return responderError(
      409,
      'El token no corresponde a un bloqueo activo de este recurso.'
    )
  }
  const lock = locks[0]
  if (lock.usuario_id !== user.id && user.rol !== 'admin') {
    return responderError(403, 'Ese bloqueo pertenece a otro usuario.')
  }

  try {
    await sbVoid(env, `locks_dav?id=eq.${lock.id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch (e) {
    if (tablaAusente(e)) return respuestaTablaAusente()
    return errorDeBd(e)
  }

  return new Response(null, { status: 204, headers: cabecerasPrivadas() })
}
