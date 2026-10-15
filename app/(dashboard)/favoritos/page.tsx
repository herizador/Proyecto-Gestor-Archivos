import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Star } from 'lucide-react'
import FileListWrapper from '@/components/FileListWrapper'
import { listarFavoritos } from '@/actions/favoritos'

// Tus marcas personales (lo que RLS oculta simplemente no aparece).
export default async function FavoritosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { archivos, carpetas } = await listarFavoritos()
  const favoritosIniciales = [
    ...archivos.map((a) => `a:${a.id}`),
    ...carpetas.map((c) => `c:${c.id}`),
  ]

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Favoritos</p>
        <h1 className="page-title">Favoritos</h1>
        <p className="page-subtitle">Tus accesos directos personales (solo los ves tú)</p>
      </div>

      {archivos.length === 0 && carpetas.length === 0 ? (
        <div className="empty-state">
          <Star size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Sin favoritos</h3>
          <p className="empty-state-text">Marca la estrella en el menú ⋯ de cualquier archivo o carpeta.</p>
        </div>
      ) : (
        <FileListWrapper
          archivos={archivos}
          carpetas={carpetas}
          accesos={[]}
          isAdmin={isAdmin}
          userId={user.id}
          favoritosIniciales={favoritosIniciales}
        />
      )}
    </div>
  )
}
