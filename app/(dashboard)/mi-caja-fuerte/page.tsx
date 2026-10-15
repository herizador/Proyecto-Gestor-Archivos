import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Lock, FileX, ChevronRight, Home } from 'lucide-react'
import UploadModalWrapper from '../UploadModalWrapper'
import NewFolderModalWrapper from '@/components/NewFolderModalWrapper'
import FileListWrapper from '@/components/FileListWrapper'
import { listarAccesos } from '@/actions/accesos'

export default async function CajaFuertePage({
  searchParams,
}: {
  searchParams: Promise<{ carpeta?: string }>
}) {
  const { carpeta: carpetaParam } = await searchParams
  const carpetaActualId = carpetaParam ?? null

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Una sola tanda en paralelo (antes: 5 idas en serie por navegación)
  const carpetasBase = supabase
    .from('carpetas')
    .select('*, creado_por_perfil:perfiles(nombre_completo)')
    .eq('es_privada', true)
    .eq('creado_por', user.id)
    .order('fecha_creacion', { ascending: true })
  const archivosBase = supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('subido_por', user.id)
    .eq('estado', 'activo')
    .like('ruta_r2', '%/privado/%')
    .order('fecha_subida', { ascending: false })

  const [perfilRes, carpetaRes, carpetasRes, archivosRes, accesosRes] = await Promise.all([
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
    carpetaActualId
      ? supabase
        .from('carpetas')
        .select('id, nombre, carpeta_padre_id, es_privada')
        .eq('id', carpetaActualId)
        .eq('es_privada', true)
        .eq('creado_por', user.id)
        .single()
      : Promise.resolve({ data: null }),
    carpetaActualId
      ? carpetasBase.eq('carpeta_padre_id', carpetaActualId)
      : carpetasBase.is('carpeta_padre_id', null),
    carpetaActualId
      ? archivosBase.eq('carpeta_id', carpetaActualId)
      : archivosBase.is('carpeta_id', null),
    listarAccesos(carpetaActualId),
  ])

  const isAdmin = perfilRes.data?.rol === 'admin'
  const carpetaActual = carpetaRes.data as { id: string; nombre: string; carpeta_padre_id: string | null } | null
  const carpetas = carpetasRes.data ?? []
  const archivos = archivosRes.data ?? []
  const accesos = accesosRes.data ?? []
  const errorAccesos = ('error' in accesosRes && accesosRes.error) || null
  if (errorAccesos) console.error('[Caja Fuerte] listarAccesos:', errorAccesos)

  const tieneContenido = carpetas.length > 0 || archivos.length > 0 || accesos.length > 0

  return (
    <div className="page-content animate-fade-in">
      <div className="safe-header">
        <div className="safe-icon">
          <Lock size={28} />
        </div>
        <div>
          <p className="eyebrow">Espacio familiar / Caja fuerte</p>
          <h1 className="page-title" style={{ fontSize: '1.4rem' }}>Mi Caja Fuerte</h1>
          <p className="page-subtitle">Nadie más de tu familia puede ver estos archivos.</p>
          {carpetaActual && (
            <nav className="breadcrumb" aria-label="Ruta de carpetas">
              <Link href="/mi-caja-fuerte" className="breadcrumb-link">
                <Home size={14} /> Raíz
              </Link>
              <ChevronRight size={14} className="breadcrumb-sep" />
              <span>{carpetaActual.nombre}</span>
            </nav>
          )}
        </div>
        <div className="safe-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <NewFolderModalWrapper carpetaPadreId={carpetaActualId} soloPrivada />
          <UploadModalWrapper scope="privado" carpetaId={carpetaActualId ?? undefined} />
        </div>
      </div>

      {!tieneContenido ? (
        <div className="empty-state">
          <FileX size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">
            {carpetaActual ? 'Esta carpeta está vacía' : 'Caja Fuerte Vacía'}
          </h3>
          <p className="empty-state-text">
            {carpetaActual
              ? 'Sube archivos o crea subcarpetas para organizar tu contenido privado.'
              : 'Aquí aparecerán los archivos que subas como privados.'}
          </p>
        </div>
      ) : (
        <>
          {errorAccesos && (
            <p className="error-msg" style={{ marginBottom: '12px' }}>
              <span>No se pudieron cargar los enlaces de esta carpeta ({errorAccesos}). Archivos y carpetas se muestran igual.</span>
            </p>
          )}
          <FileListWrapper
          archivos={archivos ?? []}
          carpetas={carpetas ?? []}
          accesos={accesos ?? []}
          isAdmin={isAdmin}
          userId={user.id}
          showOwner
          basePath="/mi-caja-fuerte"
          />
        </>
      )}
    </div>
  )
}
