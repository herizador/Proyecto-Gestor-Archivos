'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'

// La escena pesa (three.js) y no debe retrasar el primer pintado: se carga
// aparte, después de que la portada esté en pantalla. Mientras tanto (y si
// el navegador no tiene WebGL) se ve una composición CSS con el mismo aire.
const Escena3D = dynamic(() => import('@/components/inicio/Escena3D'), { ssr: false })

function soportaWebGL(): boolean {
  try {
    const lienzo = document.createElement('canvas')
    return Boolean(
      window.WebGLRenderingContext &&
      (lienzo.getContext('webgl2') || lienzo.getContext('webgl'))
    )
  } catch {
    return false
  }
}

export default function Canvas3D() {
  const contenedor = useRef<HTMLDivElement>(null)
  const [montar, setMontar] = useState(false)
  const [listo, setListo] = useState(false)
  const [enVista, setEnVista] = useState(true)
  const [pestanaVisible, setPestanaVisible] = useState(true)
  const [reducido, setReducido] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const alCambiar = () => setReducido(mq.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  useEffect(() => {
    if (!soportaWebGL()) return
    // Deja respirar al primer render de la portada antes de montar three.js.
    const temporizador = window.setTimeout(() => setMontar(true), 350)
    return () => window.clearTimeout(temporizador)
  }, [])

  useEffect(() => {
    const el = contenedor.current
    if (!el || !montar) return
    const observador = new IntersectionObserver(
      ([entrada]) => setEnVista(entrada.isIntersecting),
      { threshold: 0.05 }
    )
    observador.observe(el)
    return () => observador.disconnect()
  }, [montar])

  useEffect(() => {
    const alCambiar = () => setPestanaVisible(!document.hidden)
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])

  return (
    <div className="hero-visual" ref={contenedor} aria-hidden="true">
      <div className={`hero-fallback${listo ? ' oculto' : ''}`}>
        <span className="hero-fallback-carpeta" />
        <span className="hero-fallback-doc" />
        <span className="hero-fallback-lock">
          <LockKeyhole size={30} strokeWidth={2.2} />
        </span>
      </div>

      {montar && (
        <div className={`hero-3d-capa${listo ? ' lista' : ''}`}>
          <Escena3D
            activo={enVista && pestanaVisible}
            reducido={reducido}
            onListo={() => setListo(true)}
          />
        </div>
      )}
    </div>
  )
}
