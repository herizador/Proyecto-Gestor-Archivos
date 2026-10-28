// Acceso a Supabase PostgREST con service-role. El Worker aplica a mano la
// visibilidad y los permisos que en la PWA resuelve RLS.

import {
  LIMITE_BYTES,
  type Env,
  type UsuarioDav,
} from './env'

export class ErrorSupabase extends Error {
  readonly status: number
  readonly cuerpo: string

  constructor(status: number, cuerpo: string, recurso: string) {
    super(`Supabase ${status} en ${recurso.split('?')[0]}: ${cuerpo.slice(0, 300)}`)
    this.name = 'ErrorSupabase'
    this.status = status
    this.cuerpo = cuerpo
  }
}

async function peticion(env: Env, recurso: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${recurso}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

export async function sb<T>(env: Env, recurso: string, init?: RequestInit): Promise<T> {
  const res = await peticion(env, recurso, init)
  if (!res.ok) throw new ErrorSupabase(res.status, await res.text().catch(() => ''), recurso)
  return (await res.json()) as T
}

// PostgREST responde 204 o cuerpo vacío en PATCH/DELETE con
// Prefer: return=minimal; leerlo como JSON rompería.
export async function sbVoid(env: Env, recurso: string, init?: RequestInit): Promise<void> {
  const res = await peticion(env, recurso, init)
  if (!res.ok) throw new ErrorSupabase(res.status, await res.text().catch(() => ''), recurso)
  await res.text().catch(() => '')
}

export async function sha256hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Auth: Basic (email:token). El token es el secreto (256 bits); se valida por
// su hash en tokens_dav. El usuario del Basic se ignora en la validación.
export async function autenticar(env: Env, req: Request): Promise<UsuarioDav | null> {
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
    env,
    `tokens_dav?token_hash=eq.${hash}&revocado=eq.false&select=id,usuario_id`
  )
  if (toks.length === 0) return null
  const perf = await sb<Array<{ id: string; rol: string }>>(
    env,
    `perfiles?id=eq.${toks[0].usuario_id}&select=id,rol`
  )
  if (perf.length === 0) return null
  return { id: perf[0].id, rol: perf[0].rol, tokenId: toks[0].id }
}

// Uso total (misma función get_storage_usage que muestra ResumenFamiliar).
// Si falla se devuelve null: el listado sigue funcionando sin cuota.
export async function usoAlmacenamiento(
  env: Env
): Promise<{ usada: number; libre: number } | null> {
  try {
    const total = await sb<number>(env, 'rpc/get_storage_usage', { method: 'POST' })
    if (typeof total !== 'number' || !Number.isFinite(total)) return null
    return { usada: total, libre: Math.max(0, LIMITE_BYTES - total) }
  } catch {
    return null
  }
}

// La auditoría nunca debe tumbar la operación: se registra best-effort.
export async function auditar(
  env: Env,
  usuarioId: string,
  accion: string,
  detalles: Record<string, unknown>
): Promise<void> {
  try {
    await sbVoid(env, 'historial_actividad', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ usuario_id: usuarioId, accion, detalles }),
    })
  } catch {
    // Silencio: la operación ya se completó
  }
}

export async function tocarToken(env: Env, tokenId: string): Promise<void> {
  try {
    await sbVoid(env, `tokens_dav?id=eq.${tokenId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ultimo_uso: new Date().toISOString() }),
    })
  } catch {
    // Best-effort
  }
}
