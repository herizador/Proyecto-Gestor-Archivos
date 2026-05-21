import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, FolderHeart, Users, Lock, LogOut, ShieldAlert } from 'lucide-react'
import { logout } from '@/actions/auth'

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

        <nav className="sidebar-nav">
          <div className="nav-section-title">Navegación</div>
          <Link href="/" className="nav-item">
            <FolderHeart size={18} />
            Área Común
          </Link>
          <Link href="/familia" className="nav-item">
            <Users size={18} />
            Mi Familia
          </Link>
          <Link href="/mi-caja-fuerte" className="nav-item">
            <Lock size={18} />
            Mi Caja Fuerte
          </Link>

          {isAdmin && (
            <>
              <div className="nav-section-title" style={{ marginTop: '16px' }}>Administración</div>
              <Link href="/admin/historial" className="nav-item">
                <ShieldAlert size={18} />
                Historial (Auditoría)
              </Link>
            </>
          )}
        </nav>

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
    </div>
  )
}
