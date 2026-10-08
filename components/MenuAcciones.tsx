'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export type ItemMenu = {
  icono: React.ReactNode
  texto: string
  onClick: () => void | Promise<void>
  peligroso?: boolean
  deshabilitado?: boolean
}

// Menú ⋯ de tarjeta: disparador de 44px + desplegable en portal (fuera de la
// tarjeta, para que ninguna tarjeta vecina lo tape). Se cierra con selección,
// clic fuera, scroll o Escape. Solo transform/opacity en la animación.
export default function MenuAcciones({
  items,
  etiqueta = 'Acciones',
}: {
  items: ItemMenu[]
  etiqueta?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)

  function alternar(e: React.SyntheticEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (abierto) {
      setAbierto(false)
      return
    }
    const r = botonRef.current?.getBoundingClientRect()
    if (!r) return
    const altoEstimado = items.length * 46 + 16
    const haciaArriba = r.bottom + altoEstimado > window.innerHeight - 16
    setPos({
      left: Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)),
      top: haciaArriba ? Math.max(8, r.top - altoEstimado) : r.bottom + 6,
    })
    setAbierto(true)
  }

  useEffect(() => {
    if (!abierto) return
    function cerrar() {
      setAbierto(false)
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
      window.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        className="btn-ghost btn-icon menu-disparador"
        onClick={alternar}
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-haspopup="menu"
      >
        <MoreVertical size={20} />
      </button>
      {abierto && pos && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                className="menu-fondo"
                onClick={cerrarFondo}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setAbierto(false)
                }}
              />
              <div className="menu-desplegable" role="menu" style={{ top: pos.top, left: pos.left }}>
                {items.map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    disabled={it.deshabilitado}
                    className={`menu-item${it.peligroso ? ' menu-item-peligro' : ''}`}
                    onClick={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setAbierto(false)
                      await it.onClick()
                    }}
                  >
                    {it.icono}
                    <span>{it.texto}</span>
                  </button>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )

  function cerrarFondo(e: React.SyntheticEvent) {
    e.stopPropagation()
    setAbierto(false)
  }
}
