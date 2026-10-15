import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { History } from 'lucide-react'
import FileListWrapper from '@/components/FileListWrapper'
import { listarIdsFavoritos } from '@/actions/favoritos'

// Recientes de todo lo visible (RLS filtra solo): últimos archivos y carpetas.
export default async function RecientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const [{ data: archivos }, { data: carpetas }, favoritos] = await Promise.all([
    supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo)')
      .eq('estado', 'activo')
      .order('fecha_subida', { ascending: false })
      .limit(30),
    supabase
      .from('carpetas')
      .select('*, creado_por_perfil:perfiles(nombre_completo)')
      .order('fecha_creacion', { ascending: false })
      .limit(12),
    listarIdsFavoritos(),
  ])

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Recientes</p>
        <h1 className="page-title">Recientes</h1>
        <p className="page-subtitle">Lo último que se ha movido en la familia</p>
      </div>

      {(archivos?.length ?? 0) === 0 && (carpetas?.length ?? 0) === 0 ? (
        <div className="empty-state">
          <History size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Sin actividad reciente</h3>
          <p className="empty-state-text">Cuando se suba o cree algo, aparecerá aquí.</p>
        </div>
      ) : (
        <FileListWrapper
          archivos={archivos ?? []}
          carpetas={carpetas ?? []}
          accesos={[]}
          isAdmin={isAdmin}
          userId={user.id}
          favoritosIniciales={favoritos}
        />
      )}
    </div>
  )
}
