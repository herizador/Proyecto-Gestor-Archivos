'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Aparición suave de las secciones al bajar, en web y en móvil. Se aplica a
// los bloques marcados con data-reveal y a las cabeceras/secciones habituales
// para no tener que tocar cada página. Con "reducir movimiento" no se anima
// nada y el contenido queda visible desde el primer momento.
// GSAP se carga aparte: no debe pesar en la primera pintura del panel.
const SELECTOR = [
  '[data-reveal]',
  '.page-header',
  '.grid-stats',
  '.dos-columnas',
  '.safe-header',
  '.resumen-familiar',
  '.grid-members',
  '.table-wrap',
  '.search-section',
].join(', ')

export default function AnimacionesScroll() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let cancelado = false
    let contexto: { revert: () => void } | null = null
    let frame = 0

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ])
      if (cancelado) return

      gsap.registerPlugin(ScrollTrigger)
      contexto = gsap.context(() => {
        const elementos = gsap.utils.toArray<HTMLElement>(SELECTOR)
        elementos.forEach((el) => {
          gsap.fromTo(
            el,
            { autoAlpha: 0, y: 26 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.65,
              ease: 'power3.out',
              // GSAP deja `transform: translate(0, 0)` inline y eso convierte al
              // elemento en containing block del `position: fixed`: los modales
              // abiertos dentro de la cabecera se recortaban. Al terminar se
              // limpia el transform (el resultado visual es el mismo).
              clearProps: 'transform',
              scrollTrigger: {
                trigger: el,
                start: 'top 88%',
                once: true,
              },
            }
          )
        })
      })

      // Las fuentes y las imágenes pueden cambiar la altura: recalcula tras pintar.
      frame = window.requestAnimationFrame(() => ScrollTrigger.refresh())
    })()

    return () => {
      cancelado = true
      window.cancelAnimationFrame(frame)
      contexto?.revert()
    }
  }, [pathname])

  return null
}
