import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldCheck, LogOut } from 'lucide-react'
import { logout } from '@/actions/auth'
import MobileNavigation from '@/components/MobileNavigation'
import NavegacionLateral from '@/components/NavegacionLateral'
import PaletaComandos from '@/components/PaletaComandos'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const isAdmin = perfil?.rol === 'admin'

  return (
    <div className="dashboard-layout">
      {/* NAVEGACIÓN MÓVIL (COMPONENTE CLIENTE) */}
      <MobileNavigation perfil={perfil} isAdmin={isAdmin} />

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <ShieldCheck size={24} />
          </div>
          <div>
            <div className="sidebar-logo-text">Archivo Familiar</div>
            <div className="sidebar-logo-sub">Gestor Privado</div>
          </div>
        </div>

        <NavegacionLateral isAdmin={isAdmin} />

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div className="avatar avatar-sm">
              {perfil?.nombre_completo?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {perfil?.nombre_completo}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                {isAdmin ? 'Administrador' : 'Miembro'}
              </div>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
              <LogOut size={16} /> Cerrar Sesión
            </button>
          </form>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <main className="main-content">
        {children}
      </main>
      <PaletaComandos />
    </div>
  )
}
