import { createClient } from '@/lib/supabase/server'
import { Users, UserCircle } from 'lucide-react'

export default async function FamiliaPage() {
  const supabase = await createClient()

  // Lista todos los miembros de la familia
  const { data: perfiles } = await supabase
    .from('perfiles')
    .select('*')
    .order('nombre_completo', { ascending: true })

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Mi Familia</h1>
        <p className="page-subtitle">Explora los archivos públicos de los miembros de tu familia.</p>
      </div>

      <div className="grid-members">
        {perfiles?.map(perfil => (
          <div key={perfil.id} className="card card-hover" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '24px 16px' }}>
            <div className="avatar avatar-lg" style={{ marginBottom: '16px' }}>
              {perfil.nombre_completo?.charAt(0).toUpperCase() || <UserCircle size={32} />}
            </div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)' }}>
              {perfil.nombre_completo}
            </h3>
            <span className={`badge ${perfil.rol === 'admin' ? 'badge-admin' : 'badge-miembro'}`} style={{ marginTop: '8px' }}>
              {perfil.rol}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
