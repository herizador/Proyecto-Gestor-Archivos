'use client'

import { useMemo, useRef, type ComponentProps } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Escena 3D de la portada: una carpeta, un par de documentos y un candado
// flotando con luz suave. Se carga solo en el cliente y se pausa cuando no
// está a la vista (o cuando el sistema pide reducir movimiento).

function Caja({
  medida,
  radio = 0.09,
  ...props
}: {
  medida: [number, number, number]
  radio?: number
} & ComponentProps<'mesh'>) {
  const geometria = useMemo(
    () => new RoundedBoxGeometry(medida[0], medida[1], medida[2], 4, radio),
    [medida, radio]
  )
  return <mesh geometry={geometria} castShadow receiveShadow {...props} />
}

function Sombra() {
  const textura = useMemo(() => {
    const lienzo = document.createElement('canvas')
    lienzo.width = lienzo.height = 256
    const ctx = lienzo.getContext('2d')
    if (!ctx) return null
    const gradiente = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    gradiente.addColorStop(0, 'rgba(24,38,70,0.30)')
    gradiente.addColorStop(0.55, 'rgba(24,38,70,0.10)')
    gradiente.addColorStop(1, 'rgba(24,38,70,0)')
    ctx.fillStyle = gradiente
    ctx.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(lienzo)
    t.needsUpdate = true
    return t
  }, [])

  if (!textura) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.85, 0]} scale={[3.4, 2, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={textura} transparent depthWrite={false} />
    </mesh>
  )
}

function Documento({
  posicion,
  rotacion,
  color,
}: {
  posicion: [number, number, number]
  rotacion: [number, number, number]
  color: string
}) {
  return (
    <group position={posicion} rotation={rotacion}>
      <Caja medida={[1.02, 1.32, 0.06]} radio={0.05}>
        <meshStandardMaterial color="#ffffff" roughness={0.55} metalness={0.02} />
      </Caja>
      <Caja medida={[0.62, 0.09, 0.02]} radio={0.04} position={[-0.1, 0.44, 0.045]}>
        <meshStandardMaterial color={color} roughness={0.4} />
      </Caja>
      <Caja medida={[0.72, 0.055, 0.02]} radio={0.025} position={[-0.05, 0.24, 0.045]}>
        <meshStandardMaterial color="#dbe3f1" roughness={0.7} />
      </Caja>
      <Caja medida={[0.72, 0.055, 0.02]} radio={0.025} position={[-0.05, 0.09, 0.045]}>
        <meshStandardMaterial color="#e6ecf7" roughness={0.7} />
      </Caja>
      <Caja medida={[0.5, 0.055, 0.02]} radio={0.025} position={[-0.16, -0.06, 0.045]}>
        <meshStandardMaterial color="#e6ecf7" roughness={0.7} />
      </Caja>
    </group>
  )
}

function Candado({ posicion }: { posicion: [number, number, number] }) {
  return (
    <group position={posicion} rotation={[0.12, 0.32, -0.18]}>
      <mesh position={[0, 0.32, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.21, 0.055, 16, 40, Math.PI]} />
        <meshStandardMaterial color="#e3b44b" roughness={0.35} metalness={0.55} />
      </mesh>
      <Caja medida={[0.72, 0.6, 0.34]} radio={0.09}>
        <meshStandardMaterial color="#f7cd6d" roughness={0.32} metalness={0.42} />
      </Caja>
      <Caja medida={[0.13, 0.13, 0.06]} radio={0.05} position={[0, 0.02, 0.19]}>
        <meshStandardMaterial color="#a9781a" roughness={0.4} metalness={0.4} />
      </Caja>
      <Caja medida={[0.07, 0.16, 0.04]} radio={0.03} position={[0, -0.08, 0.2]}>
        <meshStandardMaterial color="#a9781a" roughness={0.4} metalness={0.4} />
      </Caja>
    </group>
  )
}

function Carpeta() {
  return (
    <group>
      {/* Lomo y tapa trasera */}
      <Caja medida={[2.9, 2.02, 0.18]} radio={0.12}>
        <meshStandardMaterial color="#4b6ef5" roughness={0.42} metalness={0.12} />
      </Caja>
      {/* Pestaña superior izquierda */}
      <Caja medida={[1.05, 0.3, 0.16]} radio={0.09} position={[-0.82, 1.1, 0]}>
        <meshStandardMaterial color="#3f5fda" roughness={0.45} metalness={0.1} />
      </Caja>
      {/* Hoja blanca asomando */}
      <Caja medida={[2.28, 1.5, 0.05]} radio={0.04} position={[0.06, 0.42, 0.13]} rotation={[0, 0, 0.015]}>
        <meshStandardMaterial color="#fdfefe" roughness={0.6} />
      </Caja>
      {/* Tapa delantera, ligeramente abierta */}
      <group position={[0, -0.94, 0.16]} rotation={[0.26, 0, 0]}>
        <Caja medida={[2.9, 1.86, 0.13]} radio={0.1} position={[0, 0.93, 0]}>
          <meshStandardMaterial color="#6d8cff" roughness={0.38} metalness={0.16} />
        </Caja>
        <Caja medida={[1.15, 0.2, 0.03]} radio={0.07} position={[-0.35, 1.18, 0.08]}>
          <meshStandardMaterial color="#ffffff" roughness={0.5} />
        </Caja>
        <Caja medida={[0.55, 0.08, 0.03]} radio={0.04} position={[-0.62, 0.9, 0.08]}>
          <meshStandardMaterial color="#dce6ff" roughness={0.6} />
        </Caja>
        <Caja medida={[0.86, 0.08, 0.03]} radio={0.04} position={[-0.46, 0.76, 0.08]}>
          <meshStandardMaterial color="#dce6ff" roughness={0.6} />
        </Caja>
      </group>
    </group>
  )
}

function Contenido({ reducido }: { reducido: boolean }) {
  const grupo = useRef<THREE.Group>(null)
  const { pointer } = useThree()

  useFrame((state, delta) => {
    if (!grupo.current) return
    if (reducido) return
    const t = state.clock.elapsedTime
    const d = Math.min(delta, 0.05)
    grupo.current.position.y = Math.sin(t * 0.7) * 0.08
    grupo.current.rotation.y = THREE.MathUtils.damp(grupo.current.rotation.y, -0.32 + pointer.x * 0.34, 3, d)
    grupo.current.rotation.x = THREE.MathUtils.damp(grupo.current.rotation.x, 0.06 - pointer.y * 0.18, 3, d)
  })

  return (
    <group ref={grupo} rotation={[0.06, -0.32, 0]}>
      <Sombra />
      <Carpeta />
      <Documento posicion={[1.62, 0.96, 0.52]} rotacion={[0.08, -0.22, 0.16]} color="#3b66f5" />
      <Documento posicion={[1.96, 0.28, 0.18]} rotacion={[0.02, -0.3, -0.06]} color="#0f9f6e" />
      <Candado posicion={[-1.72, -1.02, 0.78]} />
      {/* Esferas de color: dan profundidad sin ruido */}
      <mesh position={[2.25, 1.55, -0.4]}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial color="#a78bfa" roughness={0.3} />
      </mesh>
      <mesh position={[-2.3, 1.35, 0.1]}>
        <sphereGeometry args={[0.075, 24, 24]} />
        <meshStandardMaterial color="#5eead4" roughness={0.3} />
      </mesh>
      <mesh position={[-2.15, -1.55, -0.2]}>
        <sphereGeometry args={[0.06, 24, 24]} />
        <meshStandardMaterial color="#93b4ff" roughness={0.3} />
      </mesh>
    </group>
  )
}

export default function Escena3D({
  activo,
  reducido,
  onListo,
}: {
  activo: boolean
  reducido: boolean
  onListo?: () => void
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0.1, 6.5], fov: 38 }}
      frameloop={activo && !reducido ? 'always' : 'demand'}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        window.requestAnimationFrame(() => onListo?.())
      }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={1.05} />
      <directionalLight position={[4.5, 6, 5]} intensity={1.9} color="#ffffff" />
      <directionalLight position={[-4, 2, 3]} intensity={0.7} color="#c7d6ff" />
      <pointLight position={[3, -3, 4]} intensity={12} color="#7c5cff" distance={12} />
      <Contenido reducido={reducido} />
    </Canvas>
  )
}
