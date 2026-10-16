'use client'

import { useSyncExternalStore } from 'react'

// Selección global de la sesión: sobrevive a navegar entre carpetas (el estado
// local del wrapper se perdía al desmontar). Vive en memoria del bundle: un
// reload la vacía. Solo guarda ids; los objetos se resuelven al actuar.
let ids: string[] = []
const oyentes = new Set<() => void>()

function notificar() {
  oyentes.forEach((fn) => fn())
}

export function obtenerSeleccion(): string[] {
  return ids
}

export function fijarSeleccion(nuevos: string[]) {
  ids = [...new Set(nuevos)]
  notificar()
}

export function suscribirSeleccion(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

export function useSeleccion(): string[] {
  return useSyncExternalStore(suscribirSeleccion, obtenerSeleccion, () => [])
}
