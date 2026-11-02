'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_PRINCIPAL, rutaActiva } from '@/components/navegacion'

// Barra inferior móvil: las mismas cuatro opciones, siempre a la vista y
// al alcance del pulgar. Nada de drawer ni de menús escondidos.
export default function NavegacionInferior() {
  const pathname = usePathname()

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      {NAV_PRINCIPAL.map((item) => {
        const activo = rutaActiva(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`tabbar-enlace${activo ? ' activo' : ''}`}
            aria-current={activo ? 'page' : undefined}
          >
            <span className="tabbar-icono">{item.icono}</span>
            <span>{item.texto}</span>
          </Link>
        )
      })}
    </nav>
  )
}
