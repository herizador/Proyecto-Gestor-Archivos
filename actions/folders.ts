'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import type { Carpeta } from '@/types/database'
import { esColorCarpeta, COLOR_POR_DEFECTO } from '@/lib/colores-carpetas'
import { esUuidValido, sanitizarNombreArchivo } from '@/lib/archivos-seguros'
import { revalidatePath } from 'next/cache'

const MAX_NOMBRE_CARPETA = 100

export async function crearCarpeta(params: {
  nombre: string
  esPrivada: boolean
  carpetaPadreId: string | null
  color?: string
}) {
  const nombre = sanitizarNombreArchivo(params.nombre, MAX_NOMBRE_CARPETA)
  if (!nombre.trim()) return { error: 'El nombre de la carpeta no es válido.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  // El padre debe existir y ser visible (RLS); si no, el insert quedaría huérfano
  let esPrivada = params.esPrivada === true
  if (params.carpetaPadreId !== null) {
    if (!esUuidValido(params.carpetaPadreId)) {
      return { error: 'Carpeta padre no válida.' }
    }
    const { data: padre, error: padreError } = await supabase
      .from('carpetas')
      .select('id, es_privada')
      .eq('id', params.carpetaPadreId)
      .single()
    if (padreError || !padre) return { error: `Carpeta padre no válida (${padreError?.code ?? 'sin código'}: ${padreError?.message ?? 'sin detalle'}).` }
    // La privacidad se hereda: una carpeta pública dentro de una privada
    // expondría todo su contenido a la familia.
    if (padre.es_privada) esPrivada = true
  }

  const color = esColorCarpeta(params.color) ? params.color : COLOR_POR_DEFECTO

  // NUNCA encadenar .select() a este insert. El RETURNING de un INSERT vuelve a
  // evaluar la policy SELECT de `carpetas`, y `carpeta_visible_para()` es STABLE:
  // lee la tabla con el snapshot de la sentencia y no puede ver la fila que se
  // acaba de insertar, así que devuelve FALSE y Postgres aborta con
  //   42501: new row violates row-level security policy for table "carpetas"
  // (por eso subir archivos sí funcionaba: `registrarArchivo` inserta sin RETURNING).
  const { error } = await supabase.from('carpetas').insert({
    nombre,
    creado_por: user.id,
    es_privada: esPrivada,
    carpeta_padre_id: params.carpetaPadreId,
    color,
  })

  if (error) {
    console.error('[crearCarpeta] insert falló:', error.code, error.message)
    // Compatibilidad: si la columna color aún no existe en la BD (migración
    // pendiente), se reintenta sin ella en vez de romper la creación
    if (/color/i.test(error.message)) {
      const { error: error2 } = await supabase.from('carpetas').insert({
        nombre,
        creado_por: user.id,
        es_privada: esPrivada,
        carpeta_padre_id: params.carpetaPadreId,
      })
      if (error2) {
        console.error('[crearCarpeta] reintento sin color falló:', error2.code, error2.message)
        return { error: `No se pudo crear la carpeta (${error2.code ?? 'sin código'}: ${error2.message}).` }
      }
    } else {
      return { error: `No se pudo crear la carpeta (${error.code ?? 'sin código'}: ${error.message}).` }
    }
  }

  await logActivity({
    accion: 'CREAR_CARPETA',
    detalles: {
      nombre,
      es_privada: esPrivada,
      carpeta_padre_id: params.carpetaPadreId,
    },
  })

  revalidatePath('/')
  revalidatePath('/familia')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Renombrar carpeta (solo cambia el nombre visible)
// ---------------------------------------------------------------------------
export async function renombrarCarpeta(carpetaId: string, nombre: string) {
  if (!esUuidValido(carpetaId)) return { error: 'Carpeta no encontrada o sin permisos.' }
  if (!String(nombre ?? '').trim()) return { error: 'El nombre no puede estar vacío.' }
  const limpio = sanitizarNombreArchivo(nombre, MAX_NOMBRE_CARPETA)
  if (!limpio) return { error: 'El nombre no es válido.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, nombre, creado_por, es_privada')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return { error: 'Carpeta no encontrada o sin permisos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'
  if (carpeta.creado_por !== user.id) {
    // La Caja fuerte es privada también para el administrador.
    if (!isAdmin || carpeta.es_privada) {
      return { error: 'Sin permiso para renombrar esta carpeta.' }
    }
  }
  if (carpeta.nombre === limpio) return { success: true }

  const { data: actualizadas, error } = await supabase
    .from('carpetas')
    .update({ nombre: limpio })
    .eq('id', carpetaId)
    .select('id')
  if (error || !actualizadas || actualizadas.length === 0) {
    return { error: 'No se pudo renombrar la carpeta.' }
  }

  await logActivity({
    accion: 'RENOMBRAR_CARPETA',
    detalles: { carpeta_id: carpetaId, anterior: carpeta.nombre, nuevo: limpio },
  })

  revalidatePath('/')
  revalidatePath('/familia')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Cambiar el color de una carpeta (cosmético, sin auditoría)
// ---------------------------------------------------------------------------
export async function cambiarColorCarpeta(carpetaId: string, color: string) {
  if (!esUuidValido(carpetaId)) return { error: 'Carpeta no encontrada o sin permisos.' }
  if (!esColorCarpeta(color)) return { error: 'Color no válido.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, creado_por, es_privada')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return { error: 'Carpeta no encontrada o sin permisos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'
  if (carpeta.creado_por !== user.id && (!isAdmin || carpeta.es_privada)) {
    return { error: 'Sin permiso para editar esta carpeta.' }
  }

  const { data: actualizadas, error } = await supabase
    .from('carpetas')
    .update({ color })
    .eq('id', carpetaId)
    .select('id')
  if (error || !actualizadas || actualizadas.length === 0) {
    if (/color/i.test(error?.message ?? '')) {
      return { error: 'Falta aplicar la migración de color en la base de datos.' }
    }
    return { error: 'No se pudo cambiar el color de la carpeta.' }
  }

  revalidatePath('/')
  revalidatePath('/familia')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

export async function eliminarCarpeta(carpetaId: string) {
  if (!esUuidValido(carpetaId)) return { error: 'Carpeta no encontrada o sin permisos.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, nombre, creado_por, es_privada')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return { error: 'Carpeta no encontrada o sin permisos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'
  if (carpeta.creado_por !== user.id && (!isAdmin || carpeta.es_privada)) {
    return { error: 'Sin permiso para eliminar esta carpeta.' }
  }

  const { data: borradas, error } = await supabase
    .from('carpetas')
    .delete()
    .eq('id', carpetaId)
    .select('id')
  if (error || !borradas || borradas.length === 0) {
    return { error: 'No se pudo eliminar la carpeta.' }
  }

  await logActivity({
    accion: 'ELIMINAR_CARPETA',
    detalles: { carpeta_id: carpetaId, nombre: carpeta.nombre, es_privada: carpeta.es_privada },
  })

  revalidatePath('/')
  revalidatePath('/familia')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Búsqueda de carpetas visibles por nombre (para la paleta ⌘K)
// ---------------------------------------------------------------------------
export async function buscarCarpetas(termino: string) {
  const trimmed = String(termino ?? '').trim().slice(0, MAX_NOMBRE_CARPETA)
  if (!trimmed) return { data: [] as Carpeta[] }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.', data: [] as Carpeta[] }

  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

  const { data, error } = await supabase
    .from('carpetas')
    .select('*')
    .ilike('nombre', `%${escaped}%`)
    .order('fecha_creacion', { ascending: false })
    .limit(25)

  if (error) return { error: error.message, data: [] as Carpeta[] }
  return { data: (data ?? []) as Carpeta[] }
}

export async function listarCarpetas(carpetaPadreId: string | null = null) {
  const supabase = await createClient()

  const query = supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .order('fecha_creacion', { ascending: true })

  const { data, error } = carpetaPadreId
    ? await query.eq('carpeta_padre_id', carpetaPadreId)
    : await query.is('carpeta_padre_id', null)

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}
