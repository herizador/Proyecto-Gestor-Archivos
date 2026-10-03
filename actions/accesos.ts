'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import type { AccesoConObjetivo, AccesoDirecto, Carpeta } from '@/types/database'
import { revalidatePath } from 'next/cache'

function escaparLike(termino: string) {
  return termino.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ---------------------------------------------------------------------------
// Enriquecer filas de accesos con sus objetivos mediante consultas simples por
// separado (nunca un SELECT con joins por nombre de FK: si un join fallaba, la
// consulta entera devolvía error y la carpeta destino se veía vacía sin aviso).
// Un objetivo no visible por RLS queda en NULL (= huérfano) sin romper el resto.
// ---------------------------------------------------------------------------
async function enriquecerAccesos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filas: AccesoDirecto[]
): Promise<AccesoConObjetivo[]> {
  if (filas.length === 0) return []

  const archivoIds = [...new Set(
    filas.map((a) => a.archivo_objetivo_id).filter((x): x is string => typeof x === 'string' && x.length > 0)
  )]
  const carpetaIds = [...new Set(
    filas.map((a) => a.carpeta_objetivo_id).filter((x): x is string => typeof x === 'string' && x.length > 0)
  )]
  const contenedoraIds = [...new Set(filas.map((a) => a.carpeta_contenedora_id).filter((x) => typeof x === 'string' && x.length > 0))]

  type FilaArchivo = { id: string; nombre_original: string; tamano_bytes: number; tipo_mime: string; estado: string; fecha_subida: string; subido_por: string; carpeta_id: string | null }
  type FilaCarpeta = { id: string; nombre: string; carpeta_padre_id?: string | null }

  let archivos: FilaArchivo[] = []
  if (archivoIds.length > 0) {
    const res = await supabase
      .from('archivos')
      .select('id, nombre_original, tamano_bytes, tipo_mime, estado, fecha_subida, subido_por, carpeta_id')
      .in('id', archivoIds)
    if (res.error) console.error('[accesos] no se pudieron resolver archivos objetivo:', res.error.message)
    else archivos = (res.data ?? []) as FilaArchivo[]
  }

  let carpetas: FilaCarpeta[] = []
  if (carpetaIds.length > 0) {
    const res = await supabase
      .from('carpetas')
      .select('id, nombre, carpeta_padre_id')
      .in('id', carpetaIds)
    if (res.error) console.error('[accesos] no se pudieron resolver carpetas objetivo:', res.error.message)
    else carpetas = (res.data ?? []) as FilaCarpeta[]
  }

  const autorIds = [...new Set(archivos.map((a) => a.subido_por).filter((x) => typeof x === 'string' && x.length > 0))]
  const carpetaDeArchivoIds = [...new Set(archivos.map((a) => a.carpeta_id).filter((x): x is string => typeof x === 'string' && x.length > 0))]
  const padreIds = [...new Set(carpetas.map((c) => c.carpeta_padre_id).filter((x): x is string => typeof x === 'string' && x.length > 0))]

  let perfiles: Array<{ id: string; nombre_completo: string }> = []
  if (autorIds.length > 0) {
    const res = await supabase.from('perfiles').select('id, nombre_completo').in('id', autorIds)
    if (!res.error) perfiles = (res.data ?? []) as Array<{ id: string; nombre_completo: string }>
  }

  let carpetasDeArchivo: Array<{ id: string; nombre: string }> = []
  if (carpetaDeArchivoIds.length > 0) {
    const res = await supabase.from('carpetas').select('id, nombre').in('id', carpetaDeArchivoIds)
    if (!res.error) carpetasDeArchivo = (res.data ?? []) as Array<{ id: string; nombre: string }>
  }

  let padres: Array<{ id: string; nombre: string }> = []
  if (padreIds.length > 0) {
    const res = await supabase.from('carpetas').select('id, nombre').in('id', padreIds)
    if (!res.error) padres = (res.data ?? []) as Array<{ id: string; nombre: string }>
  }

  let contenedoras: Array<{ id: string; nombre: string }> = []
  if (contenedoraIds.length > 0) {
    const res = await supabase.from('carpetas').select('id, nombre').in('id', contenedoraIds)
    if (!res.error) contenedoras = (res.data ?? []) as Array<{ id: string; nombre: string }>
  }

  const porArchivo = new Map(archivos.map((a) => [a.id, a]))
  const porCarpeta = new Map(carpetas.map((c) => [c.id, c]))
  const porPerfil = new Map(perfiles.map((p) => [p.id, p]))
  const porCarpetaArchivo = new Map(carpetasDeArchivo.map((c) => [c.id, c]))
  const porPadre = new Map(padres.map((c) => [c.id, c]))
  const porContenedora = new Map(contenedoras.map((c) => [c.id, c]))

  return filas.map((a) => {
    const arch = a.archivo_objetivo_id ? (porArchivo.get(a.archivo_objetivo_id) ?? null) : null
    const carp = a.carpeta_objetivo_id ? (porCarpeta.get(a.carpeta_objetivo_id) ?? null) : null
    const perfil = arch ? (porPerfil.get(arch.subido_por) ?? null) : null
    const carpArch = arch?.carpeta_id ? (porCarpetaArchivo.get(arch.carpeta_id) ?? null) : null
    const padre = carp?.carpeta_padre_id ? (porPadre.get(carp.carpeta_padre_id) ?? null) : null
    return {
      ...a,
      archivo_objetivo: arch
        ? {
            id: arch.id,
            nombre_original: arch.nombre_original,
            tamano_bytes: arch.tamano_bytes,
            tipo_mime: arch.tipo_mime,
            estado: arch.estado as 'activo' | 'papelera',
            fecha_subida: arch.fecha_subida,
            subido_por: arch.subido_por,
            subido_por_perfil: perfil ? { nombre_completo: perfil.nombre_completo } : null,
            carpeta: carpArch ? { id: carpArch.id, nombre: carpArch.nombre } : null,
          }
        : null,
      carpeta_objetivo: carp
        ? {
            id: carp.id,
            nombre: carp.nombre,
            padre: padre ? { id: padre.id, nombre: padre.nombre } : null,
          }
        : null,
      carpeta_contenedora: porContenedora.get(a.carpeta_contenedora_id) ?? null,
    }
  })
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
    .select('*')
    .eq('carpeta_contenedora_id', carpetaContenedoraId)
    .order('fecha_creacion', { ascending: true })

  if (error) {
    console.error('[listarAccesos] error base:', error.message)
    return { error: error.message, data: [] as AccesoConObjetivo[] }
  }
  const filas = (data ?? []) as AccesoDirecto[]
  return { data: await enriquecerAccesos(supabase, filas) }
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
    const { data, error } = await supabase
      .from('accesos_directos')
      .select('*')
      .in('id', ids)
      .limit(25)
    if (error) {
      console.error('[buscarAccesos] error base:', error.message)
      return
    }
    for (const a of await enriquecerAccesos(supabase, (data ?? []) as AccesoDirecto[])) {
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
