'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldCheck, LogOut, Menu, X } from 'lucide-react'
import { logout } from '@/actions/auth'
import { SECCIONES_NAV, rutaActiva } from '@/components/NavegacionLateral'

export default function MobileNavigation({
  perfil,
  isAdmin,
}: {
  perfil: { nombre_completo?: string | null } | null
  isAdmin: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  function toggleMenu() {
    setIsOpen(!isOpen)
  }

  function closeMenu() {
    setIsOpen(false)
  }

  return (
    <>
      {/* CABECERA SUPERIOR MÓVIL */}
      <header className="mobile-topbar">
        <div className="mobile-logo">
          <div className="mobile-logo-icon">
            <ShieldCheck size={18} />
          </div>
          <span className="mobile-logo-text">Gestor Familiar</span>
        </div>
        <button
          onClick={toggleMenu}
          className="mobile-menu-btn"
          aria-label="Abrir menú de navegación"
          aria-expanded={isOpen}
        >
          <Menu size={22} />
        </button>
      </header>

      {/* OVERLAY DEL DRAWER */}
      <div
        className={`mobile-drawer-overlay ${isOpen ? 'open' : ''}`}
        onClick={closeMenu}
      />

      {/* DRAWER / MENU DESPLEGABLE */}
      <aside className={`mobile-drawer ${isOpen ? 'open' : ''}`}>
        <div className="mobile-drawer-header">
          <div className="mobile-logo">
            <div className="mobile-logo-icon">
              <ShieldCheck size={20} />
            </div>
            <span className="mobile-logo-text">Gestor Familiar</span>
          </div>
          <button
            onClick={closeMenu}
            className="mobile-drawer-close"
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav" style={{ flex: 1 }}>
          {SECCIONES_NAV.map((sec, i) => (
            <div key={sec.titulo}>
              <div className="nav-section-title" style={i > 0 ? { marginTop: '16px' } : undefined}>
                {sec.titulo}
              </div>
              {sec.items
                .filter((it) => !it.admin || isAdmin)
                .map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`nav-item${rutaActiva(pathname, it.href) ? ' active' : ''}`}
                    onClick={closeMenu}
                    aria-current={rutaActiva(pathname, it.href) ? 'page' : undefined}
                  >
                    {it.icono}
                    {it.texto}
                  </Link>
                ))}
            </div>
          ))}
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
            <button type="submit" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', minHeight: '44px' }}>
              <LogOut size={16} /> Cerrar Sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  )
}
