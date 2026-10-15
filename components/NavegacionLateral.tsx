'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, Files, UserCheck, Star, History, Users, Lock, ShieldAlert, Trash2, Settings,
} from 'lucide-react'

export type ItemNav = {
  href: string
  texto: string
  icono: React.ReactNode
  admin?: boolean
}

export const SECCIONES_NAV: Array<{ titulo: string; items: ItemNav[] }> = [
  {
    titulo: 'Espacio',
    items: [
      { href: '/inicio', texto: 'Inicio', icono: <Home size={18} /> },
      { href: '/todos', texto: 'Todos los archivos', icono: <Files size={18} /> },
      { href: '/compartido', texto: 'Compartido conmigo', icono: <UserCheck size={18} /> },
      { href: '/favoritos', texto: 'Favoritos', icono: <Star size={18} /> },
      { href: '/recientes', texto: 'Recientes', icono: <History size={18} /> },
      { href: '/familia', texto: 'Mi Familia', icono: <Users size={18} /> },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
      { href: '/mi-caja-fuerte', texto: 'Caja fuerte', icono: <Lock size={18} /> },
      { href: '/admin/historial', texto: 'Historial', icono: <ShieldAlert size={18} />, admin: true },
      { href: '/papelera', texto: 'Papelera', icono: <Trash2 size={18} /> },
      { href: '/ajustes', texto: 'Ajustes', icono: <Settings size={18} /> },
    ],
  },
]

export function rutaActiva(pathname: string, href: string): boolean {
  if (pathname === href) return true
  // El explorador clásico (/) cuelga de Todos; el detalle de miembro, de Familia
  if (href === '/todos' && pathname === '/') return true
  if (href === '/familia' && pathname.startsWith('/familia/')) return true
  return false
}

// Navegación lateral con secciones y estado activo (sidebar de escritorio).
export default function NavegacionLateral({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  return (
    <nav className="sidebar-nav">
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
                aria-current={rutaActiva(pathname, it.href) ? 'page' : undefined}
              >
                {it.icono}
                {it.texto}
              </Link>
            ))}
        </div>
      ))}
    </nav>
  )
}
