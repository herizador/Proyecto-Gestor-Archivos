'use client'

import { LayoutGrid, List } from 'lucide-react'

export type Orden = 'recientes' | 'nombre' | 'tamano'
export type Vista = 'cuadricula' | 'lista'

// Barra de orden + toggle de vista (Figma en oscuro). En `compacta` va dentro
// de la fila de búsqueda (sin su margen inferior propio).
export default function BarraOrdenVista({
  orden,
  vista,
  onOrden,
  onVista,
  compacta = false,
}: {
  orden: Orden
  vista: Vista
  onOrden: (o: Orden) => void
  onVista: (v: Vista) => void
  compacta?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        ...(compacta ? {} : { marginBottom: '16px' }),
      }}
    >
      <label className="sr-only" htmlFor={compacta ? 'orden-lista-c' : 'orden-lista'}>
        Ordenar por
      </label>
      <select
        id={compacta ? 'orden-lista-c' : 'orden-lista'}
        className="input"
        value={orden}
        onChange={(e) => onOrden(e.target.value as Orden)}
        style={{ width: 'auto', minHeight: '44px', flexShrink: 0 }}
      >
        <option value="recientes">Más recientes</option>
        <option value="nombre">Nombre (A-Z)</option>
        <option value="tamano">Tamaño</option>
      </select>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} role="group" aria-label="Tipo de vista">
        <button
          type="button"
          className={`btn-ghost btn-icon${vista === 'cuadricula' ? ' vista-activa' : ''}`}
          onClick={() => onVista('cuadricula')}
          title="Vista de cuadrícula"
          aria-label="Vista de cuadrícula"
          aria-pressed={vista === 'cuadricula'}
          style={{ minWidth: '44px', minHeight: '44px' }}
        >
          <LayoutGrid size={18} />
        </button>
        <button
          type="button"
          className={`btn-ghost btn-icon${vista === 'lista' ? ' vista-activa' : ''}`}
          onClick={() => onVista('lista')}
          title="Vista de lista"
          aria-label="Vista de lista"
          aria-pressed={vista === 'lista'}
          style={{ minWidth: '44px', minHeight: '44px' }}
        >
          <List size={18} />
        </button>
      </div>
    </div>
  )
}
