'use client'

import { useState, type ReactNode } from 'react'
import { List } from 'lucide-react'
import DocumentSearchBar from '@/components/DocumentSearchBar'
import FileListWrapper from '@/components/FileListWrapper'
import { SelectorOrden, ToggleVista, type Orden, type Vista } from '@/components/BarraOrdenVista'
import { abrirPaleta } from '@/components/PaletaComandos'
import { obtenerSeleccion } from '@/lib/seleccion'
import { Command } from 'lucide-react'
import type { AccesoConObjetivo, ArchivoConAutor, Carpeta } from '@/types/database'

type CarpetaConAutor = Carpeta & {
  creado_por_perfil?: { nombre_completo: string } | null
}

// Explorador del Área Común: búsqueda + orden/vista en una sola fila y lista.
// El estado de orden/vista vive aquí para compartirlo entre la fila de
// búsqueda (DocumentSearchBar) y la lista (FileListWrapper).
export default function ExploradorArchivos({
  archivos,
  carpetas,
  accesos = [],
  isAdmin,
  userId,
  vacio,
  favoritosIniciales = [],
  ubicaciones = {},
  seccionCarpetas = null,
  tituloArchivos,
  limiteInicial = 0,
}: {
  archivos: ArchivoConAutor[]
  carpetas: CarpetaConAutor[]
  accesos?: AccesoConObjetivo[]
  isAdmin: boolean
  userId: string
  vacio: ReactNode
  favoritosIniciales?: string[]
  ubicaciones?: Record<string, string>
  seccionCarpetas?: ReactNode
  tituloArchivos?: string | null
  limiteInicial?: number
}) {
  const [orden, setOrden] = useState<Orden>('recientes')
  const [vista, setVista] = useState<Vista>('cuadricula')
  // Si se llega con selección de otra carpeta, el modo arranca activo
  const [modo, setModo] = useState<boolean>(() => obtenerSeleccion().length > 0)
  const hayArchivos = archivos.length > 0 || accesos.length > 0
  const hayContenido = hayArchivos || carpetas.length > 0 || seccionCarpetas !== null

  return (
    <DocumentSearchBar
      userId={userId}
      isAdmin={isAdmin}
      modoSeleccion={modo}
      alCambiarModo={setModo}
      orden={orden}
      vista={vista}
      favoritosIniciales={favoritosIniciales}
      ubicaciones={ubicaciones}
      controles={(buscando) =>
        hayContenido || buscando ? (
          <>
            {!modo && (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-seleccionar"
                onClick={() => setModo(true)}
                style={{ minHeight: '44px', flexShrink: 0 }}
                title="Seleccionar varios para actuar en lote"
              >
                <List size={16} /> Seleccionar
              </button>
            )}
            <SelectorOrden orden={orden} onOrden={setOrden} id="orden-busqueda" />
            <ToggleVista vista={vista} onVista={setVista} />
            <button
              type="button"
              className="btn-ghost btn-icon btn-cmdk"
              onClick={abrirPaleta}
              title="Búsqueda rápida (Ctrl+K)"
              aria-label="Búsqueda rápida (Ctrl+K)"
              style={{ minWidth: '44px', minHeight: '44px', flexShrink: 0 }}
            >
              <Command size={18} />
            </button>
          </>
        ) : null
      }
    >
      {!hayContenido ? (
        vacio
      ) : (
        <>
          {seccionCarpetas}
          {(hayArchivos || !seccionCarpetas) && (
            <FileListWrapper
              archivos={archivos}
              carpetas={carpetas}
              accesos={accesos}
              isAdmin={isAdmin}
              userId={userId}
              ordenExterno={orden}
              vistaExterna={vista}
              alCambiarOrden={setOrden}
              alCambiarVista={setVista}
              ocultarBarra
              modoSeleccionExterno={modo}
              alCambiarModo={setModo}
              ocultarSeleccion
              favoritosIniciales={favoritosIniciales}
              ubicaciones={ubicaciones}
              tituloArchivos={tituloArchivos}
              limiteInicial={limiteInicial}
            />
          )}
        </>
      )}
    </DocumentSearchBar>
  )
}
