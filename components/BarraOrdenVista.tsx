'use client'

import { LayoutGrid, List } from 'lucide-react'

export type Orden = 'recientes' | 'nombre' | 'tamano'
export type Vista = 'cuadricula' | 'lista'

// Barra de orden + toggle de vista (Figma en oscuro). Se exportan las piezas
// por separado para componer la fila de búsqueda (escritorio y móvil).
export function SelectorOrden({
  orden,
  onOrden,
  id = 'orden-lista',
}: {
  orden: Orden
  onOrden: (o: Orden) => void
  id?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Ordenar por
      </label>
      <select
        id={id}
        className="input orden-select"
        value={orden}
        onChange={(e) => onOrden(e.target.value as Orden)}
        style={{ width: 'auto', minHeight: '44px', flexShrink: 0 }}
      >
        <option value="recientes">Más recientes</option>
        <option value="nombre">Nombre (A-Z)</option>
        <option value="tamano">Tamaño</option>
      </select>
    </>
  )
}

export function ToggleVista({
  vista,
  onVista,
}: {
  vista: Vista
  onVista: (v: Vista) => void
}) {
  return (
    <div className="grupo-vista" style={{ display: 'flex', gap: '4px', flexShrink: 0 }} role="group" aria-label="Tipo de vista">
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
  )
}

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
      <SelectorOrden orden={orden} onOrden={onOrden} id={compacta ? 'orden-lista-c' : 'orden-lista'} />
      <ToggleVista vista={vista} onVista={onVista} />
    </div>
  )
}
