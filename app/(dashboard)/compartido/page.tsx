import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { UserCheck } from 'lucide-react'
import FileListWrapper from '@/components/FileListWrapper'
import { listarCompartidoConmigo } from '@/actions/compartir-usuarios'
import { listarIdsFavoritos } from '@/actions/favoritos'

// Lo que otros miembros te han cedido nominalmente (solo lectura salvo lo
// propio: FileListWrapper ya gatinga por isAdmin/isOwner).
export default async function CompartidoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const [{ archivos, carpetas }, favoritos] = await Promise.all([
    listarCompartidoConmigo(),
    listarIdsFavoritos(),
  ])

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Compartido conmigo</p>
        <h1 className="page-title">Compartido conmigo</h1>
        <p className="page-subtitle">Lo que otros miembros te han cedido directamente</p>
      </div>

      {archivos.length === 0 && carpetas.length === 0 ? (
        <div className="empty-state">
          <UserCheck size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Nada compartido contigo</h3>
          <p className="empty-state-text">Cuando alguien te ceda un archivo o carpeta, aparecerá aquí.</p>
        </div>
      ) : (
        <FileListWrapper
          archivos={archivos}
          carpetas={carpetas}
          accesos={[]}
          isAdmin={isAdmin}
          userId={user.id}
          favoritosIniciales={favoritos}
        />
      )}
    </div>
  )
}
