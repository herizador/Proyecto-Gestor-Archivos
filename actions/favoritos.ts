'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

// ---------------------------------------------------------------------------
// Favoritos por usuario (ver docs de Fase 2 Figma). Sin auditoría: es una
// marca personal, no un cambio del contenido familiar.
// ---------------------------------------------------------------------------
export async function listarIdsFavoritos(): Promise<string[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('favoritos')
    .select('archivo_id, carpeta_id')
    .eq('usuario_id', user.id)
  return (data ?? []).flatMap((f) => [
    ...(f.archivo_id ? [`a:${f.archivo_id}`] : []),
    ...(f.carpeta_id ? [`c:${f.carpeta_id}`] : []),
  ])
}

export async function alternarFavorito(params: { tipo: 'archivo' | 'carpeta'; id: string }) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const campo = params.tipo === 'archivo' ? 'archivo_id' : 'carpeta_id'
  const { data: existente } = await supabase
    .from('favoritos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq(campo, params.id)
    .maybeSingle()

  if (existente) {
    const { error } = await supabase.from('favoritos').delete().eq('id', existente.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('favoritos').insert({
      usuario_id: user.id,
      archivo_id: params.tipo === 'archivo' ? params.id : null,
      carpeta_id: params.tipo === 'carpeta' ? params.id : null,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/favoritos')
  return { success: true, favorito: !existente }
}

export async function listarFavoritos() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[] }

  const { data: favs } = await supabase
    .from('favoritos')
    .select('archivo_id, carpeta_id')
    .eq('usuario_id', user.id)
    .order('fecha_creacion', { ascending: false })
  const archivoIds = (favs ?? []).map((f) => f.archivo_id).filter((x): x is string => !!x)
  const carpetaIds = (favs ?? []).map((f) => f.carpeta_id).filter((x): x is string => !!x)

  const [archivosRes, carpetasRes] = await Promise.all([
    archivoIds.length > 0
      ? supabase
        .from('archivos')
        .select('*, subido_por_perfil:perfiles(nombre_completo)')
        .in('id', archivoIds)
        .eq('estado', 'activo')
      : Promise.resolve({ data: [] as ArchivoConAutor[] }),
    carpetaIds.length > 0
      ? supabase
        .from('carpetas')
        .select('*, creado_por_perfil:perfiles(nombre_completo)')
        .in('id', carpetaIds)
      : Promise.resolve({ data: [] as CarpetaConAutor[] }),
  ])
  // Lo que RLS oculta simplemente no aparece (sin errores visibles)
  return {
    archivos: (archivosRes.data ?? []) as ArchivoConAutor[],
    carpetas: (carpetasRes.data ?? []) as CarpetaConAutor[],
  }
}
