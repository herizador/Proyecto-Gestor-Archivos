'use client'

import { useState } from 'react'
import { FolderOpen, ChevronRight, ChevronLeft, Check, Loader2, Home, Lock, Users } from 'lucide-react'
import { listarCarpetas } from '@/actions/folders'
import { confirmarGuardado } from '@/actions/recibir'
import type { Carpeta, FicheroEnLote } from '@/types/database'

type Scope = 'comun' | 'privado'

function esVisibleEnScope(c: Carpeta, scope: Scope, userId: string, isAdmin: boolean) {
  if (scope === 'comun') return !c.es_privada
  return c.es_privada && (c.creado_por === userId || isAdmin)
}

export default function SelectorDestino({
  loteId,
  ficheros,
  raicesComun,
  raicesPrivadas,
  userId,
  isAdmin,
}: {
  loteId: string
  ficheros: FicheroEnLote[]
  raicesComun: Carpeta[]
  raicesPrivadas: Carpeta[]
  userId: string
  isAdmin: boolean
}) {
  const [scope, setScope] = useState<Scope>('comun')
  const [pila, setPila] = useState<Carpeta[]>([])
  const [hijas, setHijas] = useState<Carpeta[]>(raicesComun)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: string } | { error: string } | null>(null)

  function cambiarScope(nuevo: Scope) {
    setScope(nuevo)
    setPila([])
    setHijas(nuevo === 'comun' ? raicesComun : raicesPrivadas)
    setResultado(null)
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
    setResultado(null)
    const destinoId = pila.length > 0 ? pila[pila.length - 1].id : null
    const res = await confirmarGuardado({ loteId, scope, carpetaDestinoId: destinoId })
    setConfirmando(false)
    if ('success' in res && res.success) {
      const total = (res as { total?: number }).total ?? ficheros.length
      const n = (res as { guardados?: number }).guardados ?? total
      setResultado({ ok: n === total ? `${n} archivo(s) guardados.` : `${n} de ${total} guardados (algunos fallaron).` })
    } else {
      setResultado({ error: ('error' in res ? res.error : 'Error al guardar.') ?? 'Error al guardar.' })
    }
  }

  const destinoActual = pila.length > 0 ? pila[pila.length - 1].nombre : 'Raíz'

  return (
    <div>
      {/* Tabs de ámbito */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          type="button"
          className={`btn ${scope === 'comun' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => cambiarScope('comun')}
          style={{ flex: 1 }}
        >
          <Users size={16} /> Área común
        </button>
        <button
          type="button"
          className={`btn ${scope === 'privado' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => cambiarScope('privado')}
          style={{ flex: 1 }}
        >
          <Lock size={16} /> Mi caja fuerte
        </button>
      </div>

      {/* Ficheros del lote */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px' }}>
          {ficheros.length} archivo(s) por guardar
        </p>
        <ul style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ficheros.map((f) => (
            <li key={f.clave} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.nombre} ({(f.tamano / 1024).toFixed(0)} KB)
            </li>
          ))}
        </ul>
      </div>

      {/* Migas + destino */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.85rem' }}>
        {pila.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={volver} disabled={cargando}>
            <ChevronLeft size={16} /> Atrás
          </button>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)' }}>
          <Home size={14} />
          {pila.map((c) => c.nombre).join(' / ')}
          {pila.length > 0 && ' '}
        </span>
      </div>

      {/* Carpetas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {cargando && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Cargando…</p>}
        {!cargando && hijas.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Sin subcarpetas aquí. Puedes guardar en este nivel.
          </p>
        )}
        {!cargando && hijas.map((c) => (
          <button
            key={c.id}
            type="button"
            className="card card-hover"
            onClick={() => entrar(c)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', textAlign: 'left', width: '100%' }}
          >
            <FolderOpen size={18} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
            <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {resultado && 'ok' in resultado && (
        <p style={{ color: 'var(--color-success, #4ade80)', fontSize: '0.9rem', marginBottom: '12px' }}>{resultado.ok}</p>
      )}
      {resultado && 'error' in resultado && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.9rem', marginBottom: '12px' }}>{resultado.error}</p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleConfirmar}
        disabled={confirmando || (resultado !== null && 'ok' in resultado)}
        style={{ width: '100%', minHeight: '44px' }}
      >
        {confirmando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {confirmando ? ' Guardando…' : ` Guardar en ${scope === 'comun' ? 'Área común' : 'Mi caja fuerte'} · ${destinoActual}`}
      </button>
    </div>
  )
}
