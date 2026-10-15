import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FolderCard from '@/components/FolderCard'
import NuevoAccesoModal from '@/components/NuevoAccesoModal'
import ExploradorArchivos from '@/components/ExploradorArchivos'
import ResumenFamiliar from '@/components/ResumenFamiliar'
import { listarIdsFavoritos } from '@/actions/favoritos'
import type { ArchivoConAutor } from '@/types/database'

const LIMITE_BYTES = 9663676416 // 9 GB, como el trigger y el Worker

type ArchivoUbicado = ArchivoConAutor & {
  carpeta: { id: string; nombre: string } | null
}

// Vista plana global: todo lo visible mezclado, con su ubicación.
// Las carpetas van por ámbito (navegación clásica en / y /mi-caja-fuerte).
export default async function TodosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const [
    comunesRes, privadasRes, archivosRes, usoRes, totalRes, miembrosRes, favIds,
  ] = await Promise.all([
    supabase
      .from('carpetas')
      .select('*, creado_por_perfil:perfiles(nombre_completo)')
      .eq('es_privada', false)
      .is('carpeta_padre_id', null)
      .order('fecha_creacion', { ascending: true }),
    supabase
      .from('carpetas')
      .select('*, creado_por_perfil:perfiles(nombre_completo)')
      .eq('es_privada', true)
      .eq('creado_por', user.id)
      .is('carpeta_padre_id', null)
      .order('fecha_creacion', { ascending: true }),
    supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo), carpeta:carpetas(id,nombre)')
      .eq('estado', 'activo')
      .order('fecha_subida', { ascending: false })
      .limit(200),
    supabase.rpc('get_storage_usage'),
    supabase.from('archivos').select('id', { count: 'exact', head: true }).eq('estado', 'activo'),
    supabase.from('perfiles').select('id', { count: 'exact', head: true }),
    listarIdsFavoritos(),
  ])

  const comunes = comunesRes.data ?? []
  const privadas = privadasRes.data ?? []
  const archivos = ((archivosRes.data ?? []) as ArchivoUbicado[]).filter((a) => a.id)
  const usoBytes = typeof usoRes.data === 'number' ? usoRes.data : 0

  const ubicaciones: Record<string, string> = {}
  for (const a of archivos) {
    ubicaciones[a.id] = a.carpeta?.nombre
      ?? (a.ruta_r2.includes('/privado/') ? 'Mi caja fuerte' : 'Área común')
  }

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Todos los archivos</p>
        <h1 className="page-title">Todos los archivos</h1>
        <p className="page-subtitle">Todo lo visible, en un solo sitio</p>
      </div>

      <ResumenFamiliar
        usoBytes={usoBytes}
        limiteBytes={LIMITE_BYTES}
        archivos={totalRes.count ?? 0}
        miembros={miembrosRes.count ?? 0}
      />

      {(comunes.length > 0 || privadas.length > 0) && (
        <section style={{ marginBottom: '24px' }}>
          <h2 className="section-title">Carpetas</h2>
          {comunes.length > 0 && (
            <>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Comunes</p>
              <div className="grid-folders" style={{ marginBottom: '16px' }}>
                {comunes.map((carpeta) => (
                  <FolderCard
                    key={carpeta.id}
                    carpeta={carpeta}
                    basePath="/"
                    crearEnlace={(isAdmin || carpeta.creado_por === user.id) ? (
                      <NuevoAccesoModal objetivoTipo="carpeta" objetivoId={carpeta.id} objetivoNombre={carpeta.nombre} />
                    ) : null}
                    puedeRenombrar={isAdmin || carpeta.creado_por === user.id}
                  />
                ))}
              </div>
            </>
          )}
          {privadas.length > 0 && (
            <>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Tus privadas</p>
              <div className="grid-folders">
                {privadas.map((carpeta) => (
                  <FolderCard
                    key={carpeta.id}
                    carpeta={carpeta}
                    basePath="/mi-caja-fuerte"
                    crearEnlace={(isAdmin || carpeta.creado_por === user.id) ? (
                      <NuevoAccesoModal objetivoTipo="carpeta" objetivoId={carpeta.id} objetivoNombre={carpeta.nombre} />
                    ) : null}
                    puedeRenombrar={isAdmin || carpeta.creado_por === user.id}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <h2 className="section-title">Archivos</h2>
      <ExploradorArchivos
        archivos={archivos}
        carpetas={[]}
        accesos={[]}
        isAdmin={isAdmin}
        userId={user.id}
        favoritosIniciales={favIds}
        ubicaciones={ubicaciones}
        vacio={
          <div className="empty-state">
            <p className="empty-state-title">Sin archivos visibles</p>
          </div>
        }
      />
    </div>
  )
}
