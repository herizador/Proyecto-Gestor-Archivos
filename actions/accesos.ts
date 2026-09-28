'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import type { AccesoConObjetivo, Carpeta } from '@/types/database'
import { revalidatePath } from 'next/cache'

const SELECT_ACCESO = `
  *,
  archivo_objetivo:archivos!accesos_directos_archivo_objetivo_id_fkey(
    id, nombre_original, tamano_bytes, tipo_mime, estado, fecha_subida, subido_por,
    subido_por_perfil:perfiles(nombre_completo),
    carpeta:carpetas!archivos_carpeta_id_fkey(id, nombre)
  ),
  carpeta_objetivo:carpetas!accesos_directos_carpeta_objetivo_id_fkey(
    id, nombre,
    padre:carpetas!carpetas_carpeta_padre_id_fkey(id, nombre)
  ),
  carpeta_contenedora:carpetas!accesos_directos_carpeta_contenedora_id_fkey(id, nombre)
`

function escaparLike(termino: string) {
  return termino.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ---------------------------------------------------------------------------
// Raíces visibles para el explorador del modal (las filtra RLS; el cliente
// separa por ámbito). Incluye userId/isAdmin para el filtrado privado.
// ---------------------------------------------------------------------------
export async function listarRaicesAcceso() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { data, error } = await supabase
    .from('carpetas')
    .select('*')
    .is('carpeta_padre_id', null)
    .order('fecha_creacion', { ascending: true })

  if (error) return { error: error.message }
  const raices = (data ?? []) as Carpeta[]
  return {
    comun: raices.filter((c) => !c.es_privada),
    privadas: raices.filter((c) => c.es_privada && (c.creado_por === user.id || isAdmin)),
    userId: user.id,
    isAdmin,
  }
}

// ---------------------------------------------------------------------------
// Listar accesos directos de una carpeta contenedora (con objetivo resuelto;
// objetivo NULL = huérfano). La contenedora es NOT NULL: la raíz no tiene.
// ---------------------------------------------------------------------------
export async function listarAccesos(carpetaContenedoraId: string | null) {
  if (!carpetaContenedoraId) return { data: [] as AccesoConObjetivo[] }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('accesos_directos')
    .select(SELECT_ACCESO)
    .eq('carpeta_contenedora_id', carpetaContenedoraId)
    .order('fecha_creacion', { ascending: true })

  if (error) return { error: error.message, data: [] as AccesoConObjetivo[] }
  return { data: (data ?? []) as unknown as AccesoConObjetivo[] }
}

// ---------------------------------------------------------------------------
// Crear acceso directo a un archivo o carpeta visible en una contenedora visible
// ---------------------------------------------------------------------------
export async function crearAcceso(params: {
  objetivoTipo: 'archivo' | 'carpeta'
  objetivoId: string
  carpetaContenedoraId: string
  nombrePersonalizado?: string | null
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  // La contenedora debe existir y ser visible (RLS); si no, error
  const { data: contenedora, error: contError } = await supabase
    .from('carpetas')
    .select('id')
    .eq('id', params.carpetaContenedoraId)
    .single()
  if (contError || !contenedora) return { error: 'Carpeta de destino no válida.' }

  if (params.objetivoTipo === 'archivo') {
    const { data: objetivo, error: objError } = await supabase
      .from('archivos')
      .select('id, estado')
      .eq('id', params.objetivoId)
      .single()
    if (objError || !objetivo) return { error: 'Archivo no encontrado o sin permisos.' }
    if (objetivo.estado !== 'activo') return { error: 'Solo se puede enlazar archivos activos.' }
  } else {
    if (params.objetivoId === params.carpetaContenedoraId) {
      return { error: 'Una carpeta no puede enlazarse a sí misma.' }
    }
    const { data: objetivo, error: objError } = await supabase
      .from('carpetas')
      .select('id')
      .eq('id', params.objetivoId)
      .single()
    if (objError || !objetivo) return { error: 'Carpeta no encontrada o sin permisos.' }
    // Anti-ciclo: la contenedora no puede ser descendiente del objetivo
    let cursor: string | null = params.carpetaContenedoraId
    for (let i = 0; i < 50 && cursor; i++) {
      if (cursor === params.objetivoId) {
        return { error: 'No se puede enlazar una carpeta dentro de sí misma o sus hijas.' }
      }
      const idActual: string = cursor
      const { data: padre }: { data: { carpeta_padre_id: string | null } | null } = await supabase
        .from('carpetas')
        .select('carpeta_padre_id')
        .eq('id', idActual)
        .single()
      cursor = padre?.carpeta_padre_id ?? null
    }
  }

  const { error: insertError } = await supabase.from('accesos_directos').insert({
    creado_por: user.id,
    carpeta_contenedora_id: params.carpetaContenedoraId,
    archivo_objetivo_id: params.objetivoTipo === 'archivo' ? params.objetivoId : null,
    carpeta_objetivo_id: params.objetivoTipo === 'carpeta' ? params.objetivoId : null,
    nombre_personalizado: params.nombrePersonalizado?.trim() || null,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return { error: 'Ya existe un enlace a ese elemento en esta carpeta.' }
    }
    return { error: insertError.message }
  }

  await logActivity({
    accion: 'CREAR_ACCESO',
    detalles: {
      objetivo_tipo: params.objetivoTipo,
      objetivo_id: params.objetivoId,
      carpeta_contenedora_id: params.carpetaContenedoraId,
    },
  })

  revalidatePath('/')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/familia')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Eliminar un acceso (nunca toca R2 ni al original)
// ---------------------------------------------------------------------------
export async function eliminarAcceso(accesoId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: acceso, error: fetchError } = await supabase
    .from('accesos_directos')
    .select('id')
    .eq('id', accesoId)
    .single()
  if (fetchError || !acceso) return { error: 'Enlace no encontrado o sin permisos.' }

  const { error } = await supabase.from('accesos_directos').delete().eq('id', accesoId)
  if (error) return { error: error.message }

  await logActivity({
    accion: 'ELIMINAR_ACCESO',
    detalles: { acceso_id: accesoId },
  })

  revalidatePath('/')
  revalidatePath('/mi-caja-fuerte')
  revalidatePath('/familia')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Buscar accesos por nombre personalizado o por nombre del archivo objetivo
// ---------------------------------------------------------------------------
export async function buscarAccesos(termino: string) {
  const trimmed = termino.trim()
  if (!trimmed) return { data: [] as AccesoConObjetivo[] }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as AccesoConObjetivo[] }

  const escaped = escaparLike(trimmed)
  const vistos = new Set<string>()
  const resultados: AccesoConObjetivo[] = []

  async function conDetalle(ids: string[]) {
    if (ids.length === 0) return
    const { data } = await supabase
      .from('accesos_directos')
      .select(SELECT_ACCESO)
      .in('id', ids)
      .limit(25)
    for (const a of ((data ?? []) as unknown as AccesoConObjetivo[])) {
      if (!vistos.has(a.id)) {
        vistos.add(a.id)
        resultados.push(a)
      }
    }
  }

  const { data: porNombre } = await supabase
    .from('accesos_directos')
    .select('id')
    .ilike('nombre_personalizado', `%${escaped}%`)
    .limit(25)
  await conDetalle((porNombre ?? []).map((r) => r.id))

  const { data: archivos } = await supabase
    .from('archivos')
    .select('id')
    .eq('estado', 'activo')
    .ilike('nombre_original', `%${escaped}%`)
    .limit(25)
  const archivoIds = (archivos ?? []).map((a) => a.id)
  if (archivoIds.length > 0) {
    const { data: porObjetivo } = await supabase
      .from('accesos_directos')
      .select('id')
      .in('archivo_objetivo_id', archivoIds)
      .limit(25)
    await conDetalle((porObjetivo ?? []).map((r) => r.id))
  }

  return { data: resultados.slice(0, 50) as AccesoConObjetivo[] }
}
