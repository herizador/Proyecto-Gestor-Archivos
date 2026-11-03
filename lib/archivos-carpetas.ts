// Recorrido de carpetas y archivos reutilizable con distintos clientes de
// Supabase: la sesión del usuario (RLS) o service-role (enlaces públicos).
// Vive fuera de las server actions para no exponer un cliente por parámetro.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ArchivoConAutor, Database } from '@/types/database'

const MAX_CARPETAS_RECORRIDAS = 200
const LOTE_IDS = 50

export type ResultadoCarpetas = {
  carpetas: string[]
  archivos: ArchivoConAutor[]
  truncado: boolean
  error?: string
}

export async function archivosDeCarpetasConCliente(
  supabase: SupabaseClient<Database>,
  carpetaIds: string[],
  limite = 100
): Promise<ResultadoCarpetas> {
  const raices = [...new Set(carpetaIds.filter(Boolean))]
  const vacio: ResultadoCarpetas = { carpetas: [], archivos: [], truncado: false }
  if (raices.length === 0) return vacio

  const vistas = new Set<string>()
  let nivel = raices.slice(0, MAX_CARPETAS_RECORRIDAS)
  let truncado = raices.length > MAX_CARPETAS_RECORRIDAS
  for (const id of nivel) vistas.add(id)

  // BFS por niveles: una consulta por lote de padres, nunca una por carpeta.
  while (nivel.length > 0) {
    const hijos: string[] = []
    for (let i = 0; i < nivel.length; i += LOTE_IDS) {
      const lote = nivel.slice(i, i + LOTE_IDS)
      const { data, error } = await supabase
        .from('carpetas')
        .select('id')
        .in('carpeta_padre_id', lote)
      if (error) {
        return { ...vacio, error: 'No se pudieron leer las subcarpetas.' }
      }
      for (const c of data ?? []) {
        if (vistas.has(c.id)) continue
        if (vistas.size >= MAX_CARPETAS_RECORRIDAS) {
          truncado = true
          break
        }
        vistas.add(c.id)
        hijos.push(c.id)
      }
    }
    nivel = hijos
  }

  const ids = [...vistas]
  const tope = Math.max(1, limite) + 1
  const archivos: ArchivoConAutor[] = []
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    if (archivos.length >= tope) break
    const lote = ids.slice(i, i + LOTE_IDS)
    const { data, error } = await supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo)')
      .in('carpeta_id', lote)
      .eq('estado', 'activo')
      .order('fecha_subida', { ascending: false })
      .limit(tope - archivos.length)
    if (error) {
      return { ...vacio, error: 'No se pudieron leer los archivos de las carpetas.' }
    }
    archivos.push(...((data ?? []) as ArchivoConAutor[]))
  }

  archivos.sort(
    (a, b) => new Date(b.fecha_subida).getTime() - new Date(a.fecha_subida).getTime()
  )
  if (archivos.length > limite) {
    archivos.length = limite
    truncado = true
  }

  return { carpetas: ids, archivos, truncado }
}
