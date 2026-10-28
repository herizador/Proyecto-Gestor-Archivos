'use server'

import { createClient } from '@/lib/supabase/server'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

const MAX_CARPETAS_RECORRIDAS = 200
const LOTE_IDS = 50

// Rehidrata ids (de cualquier carpeta) a objetos visibles: la selección global
// sobrevive a navegar, así que al actuar hay que resolver lo que no está en
// vista. RLS filtra solo; lo invisible/desaparecido se omite en silencio.
export async function resolverSeleccion(ids: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.', archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[] }

  const unicos = [...new Set(ids)].slice(0, 50)
  if (unicos.length === 0) {
    return { archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[] }
  }

  const [{ data: archivos }, { data: carpetas }] = await Promise.all([
    supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo)')
      .in('id', unicos)
      .eq('estado', 'activo'),
    supabase
      .from('carpetas')
      .select('*, creado_por_perfil:perfiles(nombre_completo)')
      .in('id', unicos),
  ])
  return {
    archivos: (archivos ?? []) as ArchivoConAutor[],
    carpetas: (carpetas ?? []) as CarpetaConAutor[],
  }
}

// Recorre una carpeta y todas sus subcarpetas (hasta 200) y devuelve los
// archivos activos que el usuario puede ver. RLS filtra el resto. `limite` es
// el máximo de archivos que se devuelven; `truncado` avisa de que hay más.
// Se pide un archivo de más para saber si la lista está incompleta.
export async function archivosDeCarpetas(carpetaIds: string[], limite = 100) {
  const supabase = await createClient()
  const raices = [...new Set(carpetaIds.filter(Boolean))]
  const vacio = { carpetas: [] as string[], archivos: [] as ArchivoConAutor[], truncado: false }
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

// Igual que resolverSeleccion, pero añade los archivos que hay dentro de las
// carpetas seleccionadas (recursivo). Lo usan los flujos de compartir: una
// carpeta aporta su contenido, no se ignora.
export async function resolverSeleccionParaCompartir(ids: string[], limiteArchivos = 100) {
  const sel = await resolverSeleccion(ids)
  if ('error' in sel) return { ...sel, truncado: false }
  if (sel.carpetas.length === 0) return { ...sel, truncado: false }

  const contenido = await archivosDeCarpetas(
    sel.carpetas.map((c) => c.id),
    limiteArchivos
  )
  if ('error' in contenido) {
    return { error: contenido.error, archivos: [] as ArchivoConAutor[], carpetas: [] as CarpetaConAutor[], truncado: false }
  }

  const directos = new Set(sel.archivos.map((a) => a.id))
  return {
    archivos: [...sel.archivos, ...contenido.archivos.filter((a) => !directos.has(a.id))],
    carpetas: sel.carpetas,
    truncado: contenido.truncado,
  }
}
