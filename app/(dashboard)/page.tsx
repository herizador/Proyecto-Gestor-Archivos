import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FolderHeart, ChevronRight, Home } from 'lucide-react'
import FileCard from '@/components/FileCard'
import FolderCard from '@/components/FolderCard'
import UploadModalWrapper from './UploadModalWrapper'
import NewFolderModalWrapper from '@/components/NewFolderModalWrapper'
import DocumentSearchBar from '@/components/DocumentSearchBar'
import StorageBar from '@/components/StorageBar'

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

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', user.id)
    .single()

  const isAdmin = perfil?.rol === 'admin'

  let carpetaActual: { id: string; nombre: string; carpeta_padre_id: string | null } | null = null
  if (carpetaActualId) {
    const { data } = await supabase
      .from('carpetas')
      .select('id, nombre, carpeta_padre_id, es_privada')
      .eq('id', carpetaActualId)
      .eq('es_privada', false)
      .single()
    carpetaActual = data
  }

  const carpetasQuery = supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .eq('es_privada', false)
    .order('fecha_creacion', { ascending: true })

  const { data: carpetas } = carpetaActualId
    ? await carpetasQuery.eq('carpeta_padre_id', carpetaActualId)
    : await carpetasQuery.is('carpeta_padre_id', null)

  const archivosQuery = supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('estado', 'activo')
    .order('fecha_subida', { ascending: false })

  const { data: archivos } = carpetaActualId
    ? await archivosQuery.eq('carpeta_id', carpetaActualId)
    : await archivosQuery.is('carpeta_id', null)

  const tieneContenido = (carpetas?.length ?? 0) > 0 || (archivos?.length ?? 0) > 0

  return (
    <div className="page-content animate-fade-in">
      <div
        className="page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}
      >
        <div>
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
          <>
            {carpetas && carpetas.length > 0 && (
              <section style={{ marginBottom: '24px' }}>
                <h2 className="section-title">Carpetas</h2>
                <div className="grid-folders">
                  {carpetas.map((carpeta) => (
                    <FolderCard key={carpeta.id} carpeta={carpeta} />
                  ))}
                </div>
              </section>
            )}

            {archivos && archivos.length > 0 && (
              <section>
                {carpetas && carpetas.length > 0 && (
                  <h2 className="section-title">Archivos</h2>
                )}
                <div className="grid-files">
                  {archivos.map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      isAdmin={isAdmin}
                      isOwner={file.subido_por === user.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </DocumentSearchBar>
    </div>
  )
}
