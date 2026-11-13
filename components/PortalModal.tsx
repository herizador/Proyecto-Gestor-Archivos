'use client'

import { createPortal } from 'react-dom'

// Monta su contenido en <body>.
//
// Los modales se declaran dentro de la página, y cualquier ancestro con
// `transform` se convierte en containing block del `position: fixed`: el overlay
// se encoge al tamaño de ese ancestro y el modal aparece recortado, desplazado y
// por debajo de la barra superior (que tiene z-index propio). Pasa con GSAP al
// animar `.page-header` / `.search-section` / `.safe-header` y con el
// `translateY` del hover de las tarjetas. En un portal no hay ancestros que lo
// condicionen.
//
// Sin estado ni efectos: los modales solo se abren con una acción del usuario,
// así que en el servidor no hay nada que hidratar y basta con comprobar que
// existe `document`.
export default function PortalModal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
