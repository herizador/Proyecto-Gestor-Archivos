// Paleta de colores de carpeta (Figma en oscuro). El `id` se guarda en
// carpetas.color; si la columna aún no existe en la BD, todo cae a 'indigo'.
export const COLORES_CARPETA = [
  { id: 'indigo', nombre: 'Índigo', },
  { id: 'violeta', nombre: 'Violeta' },
  { id: 'cian', nombre: 'Cian' },
  { id: 'verde', nombre: 'Verde' },
  { id: 'ambar', nombre: 'Ámbar' },
  { id: 'rosa', nombre: 'Rosa' },
] as const

export type ColorCarpeta = (typeof COLORES_CARPETA)[number]['id']

export const COLOR_POR_DEFECTO: ColorCarpeta = 'indigo'

export function esColorCarpeta(valor: unknown): valor is ColorCarpeta {
  return typeof valor === 'string' && (COLORES_CARPETA as readonly { id: string }[]).some((c) => c.id === valor)
}

export function colorCarpetaDe(carpeta: { color?: string | null } | null | undefined): ColorCarpeta {
  if (carpeta && esColorCarpeta(carpeta.color)) return carpeta.color
  return COLOR_POR_DEFECTO
}
