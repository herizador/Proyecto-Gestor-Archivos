// Árbol virtual: réplica a mano de la visibilidad de la PWA (RLS).
// La lectura y la escritura comparten estas consultas.

import {
  RAIZ_COMUN,
  RAIZ_PRIVADA,
  SELECT_ARCHIVO,
  SELECT_CARPETA,
  type Env,
  type FilaArchivo,
  type FilaCarpeta,
  type Scope,
  type UsuarioDav,
} from './env'
import { sb } from './supabase'

export function filtroScope(scope: Scope, userId: string): string {
  // Privado = solo propio (igual que /mi-caja-fuerte, también para admin)
  return scope === 'comun'
    ? 'es_privada=eq.false'
    : `es_privada=eq.true&creado_por=eq.${userId}`
}

export async function hijasDe(
  env: Env,
  user: UsuarioDav,
  scope: Scope,
  padre: string | null
): Promise<FilaCarpeta[]> {
  const fPadre = padre ? `carpeta_padre_id=eq.${padre}` : 'carpeta_padre_id=is.null'
  return sb<FilaCarpeta[]>(
    env,
    `carpetas?select=${SELECT_CARPETA}&${filtroScope(scope, user.id)}&${fPadre}&order=fecha_creacion`
  )
}

export async function archivosDe(
  env: Env,
  user: UsuarioDav,
  scope: Scope,
  padre: string | null
): Promise<FilaArchivo[]> {
  const fPadre = padre ? `carpeta_id=eq.${padre}` : `carpeta_id=is.null`
  let recurso = `archivos?select=${SELECT_ARCHIVO}&estado=eq.activo&${fPadre}&order=fecha_subida.desc`
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

export type Nodo =
  | { kind: 'raiz' }
  | { kind: 'ambito'; scope: Scope }
  | { kind: 'carpeta'; scope: Scope; carpeta: FilaCarpeta }
  | { kind: 'archivo'; scope: Scope; archivo: FilaArchivo }

export async function resolver(
  env: Env,
  user: UsuarioDav,
  segs: string[]
): Promise<Nodo | null> {
  if (segs.length === 0) return { kind: 'raiz' }
  const [raiz, ...resto] = segs
  const scope: Scope | null =
    raiz === RAIZ_COMUN ? 'comun' : raiz === RAIZ_PRIVADA ? 'privado' : null
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
      const arch = (await archivosDe(env, user, scope, padre)).filter(
        (a) => a.nombre_original === nombre
      )[0]
      if (arch) return { kind: 'archivo', scope, archivo: arch }
    }
    return null
  }
  if (!carpeta) return { kind: 'ambito', scope }
  return { kind: 'carpeta', scope, carpeta }
}

export function carpetaHija(
  env: Env,
  user: UsuarioDav,
  scope: Scope,
  padre: string | null,
  nombre: string
): Promise<FilaCarpeta | null> {
  return hijasDe(env, user, scope, padre).then(
    (filas) => filas.filter((c) => c.nombre === nombre)[0] ?? null
  )
}

export function archivoHijo(
  env: Env,
  user: UsuarioDav,
  scope: Scope,
  padre: string | null,
  nombre: string
): Promise<FilaArchivo | null> {
  return archivosDe(env, user, scope, padre).then(
    (filas) => filas.filter((a) => a.nombre_original === nombre)[0] ?? null
  )
}

// Anti-ciclo de MOVE: sube por los padres desde `desdeId` (máximo 50 niveles)
// y comprueba si `ancestroId` aparece en la cadena.
export async function esDescendiente(
  env: Env,
  desdeId: string,
  ancestroId: string,
  limite = 50
): Promise<boolean> {
  let cursor: string | null = desdeId
  for (let i = 0; i < limite && cursor; i++) {
    if (cursor === ancestroId) return true
    const padres: Array<{ carpeta_padre_id: string | null }> = await sb<
      Array<{ carpeta_padre_id: string | null }>
    >(env, `carpetas?id=eq.${cursor}&select=carpeta_padre_id`)
    cursor = padres[0]?.carpeta_padre_id ?? null
  }
  return false
}

export type PadreResuelto =
  | { ok: true; scope: Scope; carpetaId: string | null }
  | { ok: false; status: number; error: string }

// Resuelve la carpeta que contendrá el recurso de una ruta de escritura.
// La raíz de la unidad no es escribible: hay que entrar en un ámbito.
export async function resolverPadre(
  env: Env,
  user: UsuarioDav,
  segs: string[]
): Promise<PadreResuelto> {
  if (segs.length < 2) {
    return {
      ok: false,
      status: 409,
      error: 'Escribe dentro de «Área común» o «Mi caja fuerte».',
    }
  }
  const nodo = await resolver(env, user, segs.slice(0, -1))
  if (!nodo) {
    return { ok: false, status: 409, error: 'La carpeta de destino no existe.' }
  }
  if (nodo.kind === 'ambito') {
    return { ok: true, scope: nodo.scope, carpetaId: null }
  }
  if (nodo.kind === 'carpeta') {
    return { ok: true, scope: nodo.scope, carpetaId: nodo.carpeta.id }
  }
  return { ok: false, status: 409, error: 'El destino no es una carpeta.' }
}
