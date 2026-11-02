'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { logout } from '@/actions/auth'
import { NAV_CUENTA, NAV_SECUNDARIA } from '@/components/navegacion'

type Perfil = {
  nombre_completo?: string | null
  rol?: string | null
} | null

// Menú de la cuenta: aquí viven Ajustes, el historial de administración y
// los accesos secundarios (Compartido, Favoritos, Recientes y Familia).
// Así la barra principal puede quedarse en cuatro opciones sin esconder nada.
export default function MenuUsuario({ perfil, isAdmin }: { perfil: Perfil; isAdmin: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const nombre = perfil?.nombre_completo?.trim() || 'Mi cuenta'
  const inicial = nombre.charAt(0).toUpperCase()

  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <div className="menu-usuario" ref={contenedor}>
      <button
        type="button"
        className="menu-usuario-boton"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        aria-label="Abrir menú de la cuenta"
      >
        <span className="avatar avatar-sm">{inicial}</span>
        <span className="menu-usuario-nombre">{nombre.split(' ')[0]}</span>
        <ChevronDown size={15} className={`menu-usuario-flecha${abierto ? ' abierta' : ''}`} />
      </button>

      {abierto && (
        <div className="menu-usuario-panel" role="menu" aria-label="Tu cuenta">
          <div className="menu-usuario-cabecera">
            <span className="avatar avatar-md">{inicial}</span>
            <div style={{ minWidth: 0 }}>
              <p className="menu-usuario-titulo-nombre" title={nombre}>{nombre}</p>
              <p className="menu-usuario-rol">
                {isAdmin ? 'Administrador de la familia' : 'Miembro de la familia'}
              </p>
            </div>
          </div>

          <p className="menu-usuario-etiqueta">Tu espacio</p>
          {NAV_SECUNDARIA.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="menu-usuario-item"
              role="menuitem"
              onClick={() => setAbierto(false)}
            >
              <span className="menu-usuario-item-icono">{item.icono}</span>
              <span style={{ minWidth: 0 }}>
                <span className="menu-usuario-item-texto">{item.texto}</span>
                {item.descripcion && <span className="menu-usuario-item-desc">{item.descripcion}</span>}
              </span>
            </Link>
          ))}

          <div className="menu-usuario-separador" />
          <p className="menu-usuario-etiqueta">Cuenta</p>
          {NAV_CUENTA.filter((item) => !item.admin || isAdmin).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="menu-usuario-item"
              role="menuitem"
              onClick={() => setAbierto(false)}
            >
              <span className="menu-usuario-item-icono">{item.icono}</span>
              <span style={{ minWidth: 0 }}>
                <span className="menu-usuario-item-texto">{item.texto}</span>
                {item.descripcion && <span className="menu-usuario-item-desc">{item.descripcion}</span>}
              </span>
            </Link>
          ))}

          <form action={logout}>
            <button type="submit" className="menu-usuario-item menu-usuario-salir" role="menuitem">
              <span className="menu-usuario-item-icono"><LogOut size={17} /></span>
              <span className="menu-usuario-item-texto">Cerrar sesión</span>
            </button>
          </form>

          <p className="menu-usuario-pie">
            <UserRound size={12} /> Espacio privado de la familia
          </p>
        </div>
      )}
    </div>
  )
}
