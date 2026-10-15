'use server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/actions/storage'
import { esColorCarpeta, COLOR_POR_DEFECTO } from '@/lib/colores-carpetas'
import { revalidatePath } from 'next/cache'

export async function crearCarpeta(params: {
  nombre: string
  esPrivada: boolean
  carpetaPadreId: string | null
  color?: string
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  // El padre debe existir y ser visible (RLS); si no, el insert quedaría huérfano
  if (params.carpetaPadreId) {
    const { data: padre, error: padreError } = await supabase
      .from('carpetas')
      .select('id')
      .eq('id', params.carpetaPadreId)
      .single()
    if (padreError || !padre) return { error: 'Carpeta padre no válida.' }
  }

  const color = esColorCarpeta(params.color) ? params.color : COLOR_POR_DEFECTO
  const { error } = await supabase.from('carpetas').insert({
    nombre: params.nombre,
    creado_por: user.id,
    es_privada: params.esPrivada,
    carpeta_padre_id: params.carpetaPadreId,
    color,
  })

  if (error) {
    // Compatibilidad: si la columna color aún no existe en la BD (migración
    // pendiente), se reintenta sin ella en vez de romper la creación
    if (/color/i.test(error.message)) {
      const { error: error2 } = await supabase.from('carpetas').insert({
        nombre: params.nombre,
        creado_por: user.id,
        es_privada: params.esPrivada,
        carpeta_padre_id: params.carpetaPadreId,
      })
      if (error2) return { error: error2.message }
    } else {
      return { error: error.message }
    }
  }

  await logActivity({
    accion: 'CREAR_CARPETA',
    detalles: {
      nombre: params.nombre,
      es_privada: params.esPrivada,
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
  const limpio = nombre.trim()
  if (!limpio) return { error: 'El nombre no puede estar vacío.' }
  if (limpio.length > 100) return { error: 'Máximo 100 caracteres.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, nombre, creado_por')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return { error: 'Carpeta no encontrada o sin permisos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  if (carpeta.creado_por !== user.id && perfil?.rol !== 'admin') {
    return { error: 'Sin permiso para renombrar esta carpeta.' }
  }
  if (carpeta.nombre === limpio) return { success: true }

  const { error } = await supabase.from('carpetas').update({ nombre: limpio }).eq('id', carpetaId)
  if (error) return { error: error.message }

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
  if (!esColorCarpeta(color)) return { error: 'Color no válido.' }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { data: carpeta } = await supabase
    .from('carpetas')
    .select('id, creado_por')
    .eq('id', carpetaId)
    .single()
  if (!carpeta) return { error: 'Carpeta no encontrada o sin permisos.' }

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  if (carpeta.creado_por !== user.id && perfil?.rol !== 'admin') {
    return { error: 'Sin permiso para editar esta carpeta.' }
  }

  const { error } = await supabase.from('carpetas').update({ color }).eq('id', carpetaId)
  if (error) {
    if (/color/i.test(error.message)) {
      return { error: 'Falta aplicar la migración de color en la base de datos.' }
    }
    return { error: error.message }
  }

  revalidatePath('/')
  revalidatePath('/familia')
  revalidatePath('/mi-caja-fuerte')
  return { success: true }
}

export async function eliminarCarpeta(carpetaId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const { error } = await supabase.from('carpetas').delete().eq('id', carpetaId)
  if (error) return { error: error.message }

  revalidatePath('/')
  return { success: true }
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
