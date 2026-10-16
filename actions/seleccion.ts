'use server'

import { createClient } from '@/lib/supabase/server'
import type { ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

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
