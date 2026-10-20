'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import { revalidatePath } from 'next/cache'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

type Recurso = 'archivo' | 'carpeta'

// ---------------------------------------------------------------------------
// Cesiones nominales entre miembros (ver docs/diseno/compartidos.md).
// Solo el dueño o el admin ceden; el destinatario debe ser otro miembro.
// ---------------------------------------------------------------------------
async function soyDuenoOAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tipo: Recurso,
  id: string
) {
  if (tipo === 'archivo') {
    const { data } = await supabase.from('archivos').select('subido_por').eq('id', id).single()
    if (!data) return false
    if (data.subido_por === userId) return true
  } else {
    const { data } = await supabase.from('carpetas').select('creado_por').eq('id', id).single()
    if (!data) return false
    if (data.creado_por === userId) return true
  }
  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', userId).single()
  return perfil?.rol === 'admin'
}

export async function compartirCon(params: { tipo: Recurso; id: string; usuarioId: string }) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }
  if (params.usuarioId === user.id) return { error: 'No puedes compartir contigo mismo.' }

  const { data: destino } = await supabase.from('perfiles').select('id').eq('id', params.usuarioId).single()
  if (!destino) return { error: 'Miembro no válido.' }
  if (!(await soyDuenoOAdmin(supabase, user.id, params.tipo, params.id))) {
    return { error: 'Sin permiso para compartir este elemento.' }
  }

  const { error } = await supabase.from('compartidos').insert({
    creado_por: user.id,
    compartido_con: params.usuarioId,
    archivo_id: params.tipo === 'archivo' ? params.id : null,
    carpeta_id: params.tipo === 'carpeta' ? params.id : null,
  })
  if (error) {
    if (error.code === '23505') return { success: true, duplicado: true }
    return { error: error.message }
  }

  await logActivity({
    accion: 'COMPARTIR_USUARIO',
    detalles: { tipo: params.tipo, recurso_id: params.id, con: params.usuarioId },
  })

  revalidatePath('/compartido')
  return { success: true }
}

export async function dejarDeCompartir(params: { tipo: Recurso; id: string; usuarioId: string }) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const campo = params.tipo === 'archivo' ? 'archivo_id' : 'carpeta_id'
  const { data: fila } = await supabase
    .from('compartidos')
    .select('id, creado_por, compartido_con')
    .eq(campo, params.id)
    .eq('compartido_con', params.usuarioId)
    .maybeSingle()
  if (!fila) return { error: 'Esa cesión no existe.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const puedo = fila.creado_por === user.id || fila.compartido_con === user.id || perfil?.rol === 'admin'
  if (!puedo) return { error: 'Sin permiso.' }

  const { error } = await supabase.from('compartidos').delete().eq('id', fila.id)
  if (error) return { error: error.message }

  await logActivity({
    accion: 'COMPARTIR_USUARIO',
    detalles: { tipo: params.tipo, recurso_id: params.id, revocado_a: params.usuarioId },
  })

  revalidatePath('/compartido')
  return { success: true }
}

export async function listarConQuienComparto(params: { tipo: Recurso; id: string }) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as Array<{ id: string; nombre: string }> }

  const campo = params.tipo === 'archivo' ? 'archivo_id' : 'carpeta_id'
  const { data, error } = await supabase
    .from('compartidos')
    .select('compartido_con')
    .eq(campo, params.id)
  if (error) return { error: error.message, data: [] as Array<{ id: string; nombre: string }> }

  const ids = [...new Set((data ?? []).map((r) => r.compartido_con))]
  if (ids.length === 0) return { data: [] as Array<{ id: string; nombre: string }> }
  const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', ids)
  return {
    data: ((perfiles ?? []) as Array<{ id: string; nombre_completo: string }>).map((p) => ({
      id: p.id,
      nombre: p.nombre_completo,
    })),
  }
}

export async function listarMiembros() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as Array<{ id: string; nombre: string }> }

  // Requiere la policy de directorio (ver supabase/migraciones/directorio.sql):
  // todo autenticado ve id + nombre del resto.
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre_completo')
    .neq('id', user.id)
    .order('nombre_completo', { ascending: true })
  if (error) return { error: error.message, data: [] as Array<{ id: string; nombre: string }> }
  return {
    data: ((data ?? []) as Array<{ id: string; nombre_completo: string }>).map((p) => ({
      id: p.id,
      nombre: p.nombre_completo,
    })),
  }
}

export async function listarCompartidoConmigo() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[] }

  const { data: cesiones, error } = await supabase
    .from('compartidos')
    .select('archivo_id, carpeta_id')
    .eq('compartido_con', user.id)
  if (error) return { error: error.message, archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[] }

  const archivoIds = (cesiones ?? []).map((c) => c.archivo_id).filter((x): x is string => !!x)
  const carpetaIds = (cesiones ?? []).map((c) => c.carpeta_id).filter((x): x is string => !!x)

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
  // Lo revocado o en papelera simplemente no aparece (RLS + estado)
  return {
    archivos: (archivosRes.data ?? []) as ArchivoConAutor[],
    carpetas: (carpetasRes.data ?? []) as CarpetaConAutor[],
  }
}
