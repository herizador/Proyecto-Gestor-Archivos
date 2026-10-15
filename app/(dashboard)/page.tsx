import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FolderHeart, ChevronRight, Home } from 'lucide-react'
import UploadModalWrapper from './UploadModalWrapper'
import NewFolderModalWrapper from '@/components/NewFolderModalWrapper'
import DocumentSearchBar from '@/components/DocumentSearchBar'
import StorageBar from '@/components/StorageBar'
import FileListWrapper from '@/components/FileListWrapper'
import ResumenFamiliar from '@/components/ResumenFamiliar'
import { listarAccesos } from '@/actions/accesos'
import { getStorageUsage } from '@/actions/files'

// Cupo familiar (mismo que el trigger validar_limite_almacenamiento y el Worker)
const LIMITE_BYTES = 9663676416 // 9 GB

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

  const [perfilRes, carpetaRes, carpetasRes, archivosRes, accesosRes, usoRes, totalArchivosRes, miembrosRes] = await Promise.all([
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
    carpetaActualId
      ? supabase
        .from('carpetas')
        .select('id, nombre, carpeta_padre_id, es_privada')
        .eq('id', carpetaActualId)
        .eq('es_privada', false)
        .single()
      : Promise.resolve({ data: null }),
    carpetaActualId
      ? carpetasBase.eq('carpeta_padre_id', carpetaActualId)
      : carpetasBase.is('carpeta_padre_id', null),
    carpetaActualId
      ? archivosBase.eq('carpeta_id', carpetaActualId)
      : archivosBase.is('carpeta_id', null),
    listarAccesos(carpetaActualId),
    getStorageUsage(),
    supabase.from('archivos').select('id', { count: 'exact', head: true }).eq('estado', 'activo'),
    supabase.from('perfiles').select('id', { count: 'exact', head: true }),
  ])

  const isAdmin = perfilRes.data?.rol === 'admin'
  const carpetaActual = carpetaRes.data as { id: string; nombre: string; carpeta_padre_id: string | null } | null
  const carpetas = carpetasRes.data ?? []
  const archivos = archivosRes.data ?? []
  const accesos = accesosRes.data ?? []
  const errorAccesos = ('error' in accesosRes && accesosRes.error) || null
  if (errorAccesos) console.error('[Área Común] listarAccesos:', errorAccesos)
  const tieneContenido = carpetas.length > 0 || archivos.length > 0 || accesos.length > 0

  return (
    <div className="page-content animate-fade-in">
      <div
        className="page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}
      >
        <div>
          <p className="eyebrow">Espacio familiar / Área común{carpetaActual ? ` / ${carpetaActual.nombre}` : ''}</p>
          <h1 className="page-title">Área Común</h1>
          <p className="page-subtitle">Documentos visibles para toda la familia</p>
          {carpetaActual && (
            <nav className="breadcrumb" aria-label="Ruta de carpetas">
              <Link href="/" className="breadcrumb-link">
                <Home size={14} /> Raíz
              </Link>
              <ChevronRight size={14} className="breadcrumb-sep" />
              <span>{carpetaActual.nombre}</span>
            </nav>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <NewFolderModalWrapper carpetaPadreId={carpetaActualId} />
          <UploadModalWrapper scope="comun" carpetaId={carpetaActualId ?? undefined} />
        </div>
      </div>

      {isAdmin && <StorageBar isAdmin={isAdmin} />}

      {!carpetaActual && (
        <ResumenFamiliar
          usoBytes={usoRes}
          limiteBytes={LIMITE_BYTES}
          archivos={totalArchivosRes.count ?? 0}
          miembros={miembrosRes.count ?? 0}
        />
      )}

      {errorAccesos && (
        <p className="error-msg" style={{ marginBottom: '12px' }}>
          <span>No se pudieron cargar los enlaces de esta carpeta ({errorAccesos}). Archivos y carpetas se muestran igual.</span>
        </p>
      )}

      <DocumentSearchBar userId={user.id} isAdmin={isAdmin}>
        {!tieneContenido ? (
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
        ) : (
          <FileListWrapper
            archivos={archivos ?? []}
            carpetas={carpetas ?? []}
            accesos={accesos ?? []}
            isAdmin={isAdmin}
            userId={user.id}
          />
        )}
      </DocumentSearchBar>
    </div>
  )
}
