import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FolderHeart, ChevronRight, Home } from 'lucide-react'
import UploadModalWrapper from './UploadModalWrapper'
import NewFolderModalWrapper from '@/components/NewFolderModalWrapper'
import ExploradorArchivos from '@/components/ExploradorArchivos'
import { listarAccesos } from '@/actions/accesos'
import { listarIdsFavoritos } from '@/actions/favoritos'

export default async function DashboardComun({
  searchParams,
}: {
  searchParams: Promise<{ carpeta?: string }>
}) {
  const { carpeta: carpetaParam } = await searchParams
  const carpetaActualId = carpetaParam ?? null

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Sin carpeta, la portada plana de /todos es la vista canónica (esta ruta
  // queda para navegar por el árbol clásico: /?carpeta=<id>)
  if (!carpetaActualId) redirect('/todos')

  // Todo lo independiente viaja en una sola tanda (las consultas se lanzan
  // juntas; antes iban en serie y cada navegación pagaba 5-6 idas a la BD)
  const carpetasBase = supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .eq('es_privada', false)
    .order('fecha_creacion', { ascending: true })
  const archivosBase = supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('estado', 'activo')
    .order('fecha_subida', { ascending: false })

  const [perfilRes, carpetaRes, carpetasRes, archivosRes, accesosRes, favIds] = await Promise.all([
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
    supabase
      .from('carpetas')
      .select('id, nombre, carpeta_padre_id, es_privada')
      .eq('id', carpetaActualId)
      .eq('es_privada', false)
      .single(),
    carpetasBase.eq('carpeta_padre_id', carpetaActualId),
    archivosBase.eq('carpeta_id', carpetaActualId),
    listarAccesos(carpetaActualId),
    listarIdsFavoritos(),
  ])

  const isAdmin = perfilRes.data?.rol === 'admin'
  const carpetaActual = carpetaRes.data as { id: string; nombre: string; carpeta_padre_id: string | null } | null
  // Id inexistente o sin permiso: de vuelta al plano general en vez de vacío confuso
  if (!carpetaActual) redirect('/todos')
  const carpetas = carpetasRes.data ?? []
  const archivos = archivosRes.data ?? []
  const accesos = accesosRes.data ?? []
  const errorAccesos = ('error' in accesosRes && accesosRes.error) || null
  if (errorAccesos) console.error('[Área Común] listarAccesos:', errorAccesos)

  return (
    <div className="page-content animate-fade-in">
      <div
        className="page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}
      >
        <div>
          <p className="eyebrow">Espacio familiar / Área común / {carpetaActual?.nombre ?? ''}</p>
          <h1 className="page-title">Área Común</h1>
          <p className="page-subtitle">Documentos visibles para toda la familia</p>
          <nav className="breadcrumb" aria-label="Ruta de carpetas">
            <Link href="/todos" className="breadcrumb-link">
              <Home size={14} /> Raíz
            </Link>
            <ChevronRight size={14} className="breadcrumb-sep" />
            <span>{carpetaActual?.nombre}</span>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <NewFolderModalWrapper carpetaPadreId={carpetaActualId} />
          <UploadModalWrapper scope="comun" carpetaId={carpetaActualId ?? undefined} />
        </div>
      </div>

      {errorAccesos && (
        <p className="error-msg" style={{ marginBottom: '12px' }}>
          <span>No se pudieron cargar los enlaces de esta carpeta ({errorAccesos}). Archivos y carpetas se muestran igual.</span>
        </p>
      )}

      <ExploradorArchivos
        archivos={archivos ?? []}
        carpetas={carpetas ?? []}
        accesos={accesos ?? []}
        isAdmin={isAdmin}
        userId={user.id}
        favoritosIniciales={favIds}
        vacio={
          <div className="empty-state">
            <FolderHeart size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">
              {carpetaActual ? 'Esta carpeta está vacía' : 'No hay documentos comunes'}
            </h3>
            <p className="empty-state-text">
              {carpetaActual
                ? 'Sube archivos o crea subcarpetas para organizar el contenido.'
                : 'Sube el primer archivo o crea una carpeta para compartir con tu familia.'}
            </p>
          </div>
        }
      />
    </div>
  )
}
