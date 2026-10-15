import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home, UserCircle, Users } from 'lucide-react'
import FileListWrapper from '@/components/FileListWrapper'
import type { ArchivoConAutor } from '@/types/database'
import { listarIdsFavoritos } from '@/actions/favoritos'

// Archivos públicos de un miembro: del explorador principal pero filtrados.
// Las carpetas enlazan a /?carpeta= para seguir navegando con normalidad.
export default async function MiembroPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: miembroId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { data: miembro } = await supabase.from('perfiles').select('*').eq('id', miembroId).single()
  if (!miembro) {
    return (
      <div className="page-content animate-fade-in">
        <div className="empty-state">
          <Users size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Miembro no encontrado</h3>
          <p className="empty-state-text">Puede que no tengas permiso para verlo.</p>
          <Link className="btn btn-ghost" href="/familia" style={{ marginTop: '16px', textDecoration: 'none' }}>
            Volver a Mi Familia
          </Link>
        </div>
      </div>
    )
  }

  const { data: carpetasPub } = await supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .eq('creado_por', miembroId)
    .eq('es_privada', false)
    .order('fecha_creacion', { ascending: true })
  const idsPublicas = (carpetasPub ?? []).map((c) => c.id)
  const raices = (carpetasPub ?? []).filter((c) => c.carpeta_padre_id === null)

  const archivosBase = supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('subido_por', miembroId)
    .eq('estado', 'activo')
    .order('fecha_subida', { ascending: false })
    .limit(50)
  const [enCarpetas, enRaiz, favIds] = await Promise.all([
    idsPublicas.length > 0 ? archivosBase.in('carpeta_id', idsPublicas) : Promise.resolve({ data: [] }),
    supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo)')
      .eq('subido_por', miembroId)
      .eq('estado', 'activo')
      .is('carpeta_id', null)
      .like('ruta_r2', 'comun/%')
      .order('fecha_subida', { ascending: false })
      .limit(50),
    listarIdsFavoritos(),
  ])
  const archivos = ([...(enCarpetas.data ?? []), ...(enRaiz.data ?? [])] as ArchivoConAutor[])
    .sort((a, b) => +new Date(b.fecha_subida) - +new Date(a.fecha_subida))
    .slice(0, 50)

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div className="avatar avatar-lg">
          {miembro.nombre_completo?.charAt(0).toUpperCase() || <UserCircle size={32} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1
            className="page-title"
            title={miembro.nombre_completo}
            style={{ fontSize: '1.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {miembro.nombre_completo}
          </h1>
          <p className="page-subtitle">Archivos públicos de este miembro</p>
          <nav className="breadcrumb" aria-label="Volver">
            <Link href="/familia" className="breadcrumb-link">
              <Home size={14} /> Mi Familia
            </Link>
            <ChevronRight size={14} className="breadcrumb-sep" />
            <span>Archivos públicos</span>
          </nav>
        </div>
      </div>

      {raices.length === 0 && archivos.length === 0 ? (
        <div className="empty-state">
          <Users size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Sin contenido público</h3>
          <p className="empty-state-text">Este miembro aún no tiene carpetas ni archivos públicos.</p>
        </div>
      ) : (
        <FileListWrapper
          archivos={archivos}
          carpetas={raices}
          accesos={[]}
          isAdmin={isAdmin}
          userId={user.id}
          favoritosIniciales={favIds}
        />
      )}
    </div>
  )
}
