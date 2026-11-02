'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, ShieldCheck } from 'lucide-react'
import { NAV_PRINCIPAL, rutaActiva } from '@/components/navegacion'
import MenuUsuario from '@/components/MenuUsuario'
import { abrirPaleta } from '@/components/PaletaComandos'

// Barra superior de escritorio y tablet: marca, las cuatro puertas de la app
// y las acciones de cuenta. En móvil se queda en marca + buscar + avatar,
// mientras la navegación principal pasa a la barra inferior.
export default function NavegacionSuperior({
  perfil,
  isAdmin,
}: {
  perfil: { nombre_completo?: string | null; rol?: string | null } | null
  isAdmin: boolean
}) {
  const pathname = usePathname()

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/inicio" className="marca" aria-label="Ir al inicio">
          <span className="marca-icono">
            <ShieldCheck size={21} />
          </span>
          <span className="marca-texto">
            <strong>Archivo Familiar</strong>
            <small>Gestor privado</small>
          </span>
        </Link>

        <nav className="topnav-principal" aria-label="Navegación principal">
          {NAV_PRINCIPAL.map((item) => {
            const activo = rutaActiva(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`topnav-enlace${activo ? ' activo' : ''}`}
                aria-current={activo ? 'page' : undefined}
              >
                {item.icono}
                <span>{item.texto}</span>
              </Link>
            )
          })}
        </nav>

        <div className="topnav-acciones">
          <button
            type="button"
            className="btn-busqueda"
            onClick={abrirPaleta}
            title="Buscar en todo el archivo (Ctrl+K)"
            aria-label="Buscar en todo el archivo"
          >
            <Search size={17} />
            <span className="btn-busqueda-texto">Buscar</span>
            <kbd>Ctrl K</kbd>
          </button>
          <MenuUsuario perfil={perfil} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  )
}
