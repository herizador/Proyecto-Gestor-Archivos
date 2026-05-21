import { createClient } from '@/lib/supabase/server'
import { ShieldCheck, UserCircle } from 'lucide-react'

export default async function UsuariosPage() {
  const supabase = await createClient()

  const { data: perfiles } = await supabase
    .from('perfiles')
    .select('*')
    .order('fecha_registro', { ascending: false })

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)' }}>
          <ShieldCheck size={28} />
        </div>
        <div>
          <h1 className="page-title">Gestión de Usuarios</h1>
          <p className="page-subtitle">Administra los accesos y roles de la familia.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Fecha de Registro</th>
            </tr>
          </thead>
          <tbody>
            {perfiles?.map((perfil) => (
              <tr key={perfil.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="avatar avatar-sm">
                      {perfil.nombre_completo?.charAt(0).toUpperCase() || <UserCircle size={16} />}
                    </div>
                    <strong>{perfil.nombre_completo || 'Usuario sin nombre'}</strong>
                  </div>
                </td>
                <td>
                  <span className={`badge ${perfil.rol === 'admin' ? 'badge-admin' : 'badge-miembro'}`}>
                    {perfil.rol}
                  </span>
                </td>
                <td>
                  {new Date(perfil.fecha_registro).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
