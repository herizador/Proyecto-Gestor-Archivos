'use client'

import { useState } from 'react'
import { FolderOpen, ChevronRight, ChevronLeft, Check, Loader2, Home, Lock, Users } from 'lucide-react'
import { listarCarpetas } from '@/actions/folders'
import type { Carpeta } from '@/types/database'

export type ScopeDestino = 'comun' | 'privado'

export type DestinoElegido = {
  scope: ScopeDestino
  carpetaId: string | null
}

function esVisibleEnScope(c: Carpeta, scope: ScopeDestino, userId: string, isAdmin: boolean) {
  if (scope === 'comun') return !c.es_privada
  return c.es_privada && (c.creado_por === userId || isAdmin)
}

// Navegador de destino reutilizable (lotes del share + nuevos accesos directos):
// tabs de ámbito, migas, lista de carpetas y botón de confirmación genérico.
export default function ExploradorDestino({
  raicesComun,
  raicesPrivadas,
  userId,
  isAdmin,
  initialScope = 'comun',
  requiereCarpeta = false,
  textoBoton,
  onConfirmar,
}: {
  raicesComun: Carpeta[]
  raicesPrivadas: Carpeta[]
  userId: string
  isAdmin: boolean
  initialScope?: ScopeDestino
  requiereCarpeta?: boolean
  textoBoton: (scope: ScopeDestino, destinoNombre: string) => string
  onConfirmar: (destino: DestinoElegido) => Promise<{ error?: string }>
}) {
  const [scope, setScope] = useState<ScopeDestino>(initialScope)
  const [pila, setPila] = useState<Carpeta[]>([])
  const [hijas, setHijas] = useState<Carpeta[]>(
    initialScope === 'comun' ? raicesComun : raicesPrivadas
  )
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cambiarScope(nuevo: ScopeDestino) {
    setScope(nuevo)
    setPila([])
    setHijas(nuevo === 'comun' ? raicesComun : raicesPrivadas)
    setError(null)
  }

  async function entrar(carpeta: Carpeta) {
    setCargando(true)
    const res = await listarCarpetas(carpeta.id)
    setCargando(false)
    if ('error' in res && res.error) return
    const datos = ((res as { data?: Carpeta[] }).data ?? []).filter((c) => esVisibleEnScope(c, scope, userId, isAdmin))
    setPila((prev) => [...prev, carpeta])
    setHijas(datos)
  }

  async function volver() {
    const nuevaPila = pila.slice(0, -1)
    const padre = nuevaPila[nuevaPila.length - 1]
    setCargando(true)
    if (!padre) {
      setPila([])
      setHijas(scope === 'comun' ? raicesComun : raicesPrivadas)
    } else {
      const res = await listarCarpetas(padre.id)
      const datos = ('error' in res && res.error)
        ? []
        : ((res as { data?: Carpeta[] }).data ?? []).filter((c) => esVisibleEnScope(c, scope, userId, isAdmin))
      setPila(nuevaPila)
      setHijas(datos)
    }
    setCargando(false)
  }

  async function handleConfirmar() {
    setConfirmando(true)
    setError(null)
    const destinoId = pila.length > 0 ? pila[pila.length - 1].id : null
    const res = await onConfirmar({ scope, carpetaId: destinoId })
    setConfirmando(false)
    if (res?.error) setError(res.error)
  }

  const destinoActual = pila.length > 0 ? pila[pila.length - 1].nombre : 'Raíz'
  const sinDestino = requiereCarpeta && pila.length === 0

  return (
    <div className="destino-explorador" style={{ minWidth: 0 }}>
      {/* Tabs de ámbito */}
      <div className="destino-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          type="button"
          className={`btn ${scope === 'comun' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => cambiarScope('comun')}
          style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.3 }}
        >
          <Users size={16} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Área común</span>
        </button>
        <button
          type="button"
          className={`btn ${scope === 'privado' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => cambiarScope('privado')}
          style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.3 }}
        >
          <Lock size={16} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Mi caja fuerte</span>
        </button>
      </div>

      {/* Migas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.85rem', minWidth: 0 }}>
        {pila.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={volver} disabled={cargando} style={{ flexShrink: 0 }}>
            <ChevronLeft size={16} /> Atrás
          </button>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Home size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pila.map((c) => c.nombre).join(' / ')}
          </span>
        </span>
      </div>

      {/* Carpetas: altura mínima para que el modal no salte de tamaño al navegar */}
      <div className="destino-lista" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', minHeight: '180px', maxHeight: '40vh', overflowY: 'auto', minWidth: 0 }}>
        {cargando && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Cargando…</p>}
        {!cargando && hijas.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            {requiereCarpeta
              ? 'Entra en una carpeta: los enlaces no pueden vivir en la raíz.'
              : 'Sin subcarpetas aquí. Puedes guardar en este nivel.'}
          </p>
        )}
        {!cargando && hijas.map((c) => (
          <button
            key={c.id}
            type="button"
            className="card"
            onClick={() => entrar(c)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', textAlign: 'left', width: '100%' }}
          >
            <FolderOpen size={18} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
            <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.9rem', marginBottom: '12px' }}>{error}</p>
      )}

      <button
        type="button"
        className="btn btn-primary destino-confirmar"
        onClick={handleConfirmar}
        disabled={confirmando || sinDestino}
        style={{ width: '100%', minHeight: '44px', whiteSpace: 'normal', textAlign: 'center', justifyContent: 'center', lineHeight: 1.4, wordBreak: 'break-word' }}
      >
        {confirmando ? <Loader2 size={16} className="animate-spin" style={{ flexShrink: 0 }} /> : <Check size={16} style={{ flexShrink: 0 }} />}
        <span style={{ minWidth: 0 }}>{confirmando ? ' Guardando…' : ` ${textoBoton(scope, destinoActual)}`}</span>
      </button>
    </div>
  )
}
