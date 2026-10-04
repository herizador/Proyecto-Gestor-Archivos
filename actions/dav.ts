'use server'

import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type TokenDavVisible = {
  id: string
  nombre: string
  revocado: boolean
  ultimo_uso: string | null
  fecha_creacion: string
  propietario: string | null
}

// ---------------------------------------------------------------------------
// Tokens de Explorador para el puente WebDAV (ver docs/diseno-webdav.md).
// El token en claro se devuelve SOLO al crearlo; en BD solo vive su SHA-256.
// RLS: cada usuario gestiona los suyos; el admin ve/revoca los de todos.
// ---------------------------------------------------------------------------
export async function listarTokensDav() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as TokenDavVisible[] }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { data, error } = await supabase
    .from('tokens_dav')
    .select('id, nombre, revocado, ultimo_uso, fecha_creacion, usuario_id')
    .order('fecha_creacion', { ascending: false })
  if (error) return { error: error.message, data: [] as TokenDavVisible[] }

  const filas = (data ?? []) as Array<TokenDavVisible & { usuario_id: string }>
  if (!isAdmin) {
    return { data: filas.filter((t) => t.usuario_id === user.id) }
  }
  const ids = [...new Set(filas.map((t) => t.usuario_id))]
  const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', ids)
  const nombres = new Map(((perfiles ?? []) as Array<{ id: string; nombre_completo: string }>).map((p) => [p.id, p.nombre_completo]))
  return { data: filas.map((t) => ({ ...t, propietario: nombres.get(t.usuario_id) ?? null })) }
}

export async function crearTokenDav(nombre: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const limpio = nombre.trim().slice(0, 60)
  if (!limpio) return { error: 'Ponle un nombre (p. ej. "Portátil trabajo").' }

  // 256 bits en hex; el hash es lo único que se guarda
  const token = `gf_${randomBytes(32).toString('hex')}`
  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data, error } = await supabase
    .from('tokens_dav')
    .insert({ usuario_id: user.id, nombre: limpio, token_hash: tokenHash })
    .select('id, nombre, fecha_creacion')
    .single()
  if (error || !data) return { error: error?.message ?? 'No se pudo crear el token.' }

  revalidatePath('/ajustes')
  return { success: true, token, id: data.id as string }
}

export async function revocarTokenDav(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('tokens_dav').update({ revocado: true }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/ajustes')
  return { success: true }
}

export async function eliminarTokenDav(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('tokens_dav').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/ajustes')
  return { success: true }
}
