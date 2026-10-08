'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Link2, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { crearAccesosBatch, listarRaicesAcceso, type ObjetivoEnlace } from '@/actions/accesos'
import ExploradorDestino, { type DestinoElegido } from '@/components/ExploradorDestino'
import { avisar } from '@/components/Avisos'
import type { Carpeta } from '@/types/database'

type Resultado = {
  creados: number
  omitidos: number
  fallidos: Array<{ id: string; nombre: string; error: string }>
  total: number
}

// Botón "Enlazar" del modo selección + modal: enlaza N archivos/carpetas al
// mismo destino de una vez (sin duplicar bytes). Los duplicados se omiten.
export default function EnlazarSeleccionModal({
  objetivos,
  basePath = '/',
  onEnlazados,
}: {
  objetivos: ObjetivoEnlace[]
  basePath?: string
  onEnlazados: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [raices, setRaices] = useState<{ comun: Carpeta[]; privadas: Carpeta[] } | null>(null)
  const [cargandoRaices, setCargandoRaices] = useState(false)
  const [userId, setUserId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [destinoId, setDestinoId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setResultado(null)
        setDestinoId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  async function abrir() {
    if (objetivos.length === 0) return
    setCargandoRaices(true)
    try {
      const res = await listarRaicesAcceso()
      if ('error' in res) {
        avisar('error', res.error ?? 'No se pudieron cargar las carpetas.')
        return
      }
      setRaices({ comun: res.comun, privadas: res.privadas })
      setUserId(res.userId)
      setIsAdmin(res.isAdmin)
      setResultado(null)
      setDestinoId(null)
      setIsOpen(true)
    } catch {
      avisar('error', 'No se pudieron cargar las carpetas. Revisa tu conexión.')
    } finally {
      setCargandoRaices(false)
    }
  }

  function cerrar() {
    setIsOpen(false)
    setResultado(null)
    setDestinoId(null)
  }

  function cerrarYLimpiar() {
    cerrar()
    onEnlazados()
  }

  async function handleConfirmar(destino: DestinoElegido) {
    if (!destino.carpetaId) return { error: 'Elige una carpeta de destino.' }
    const res = await crearAccesosBatch({ objetivos, carpetaContenedoraId: destino.carpetaId })
    if ('error' in res && res.error) {
      return { error: res.error }
    }
    if ('success' in res && res.success) {
      setResultado({ creados: res.creados ?? 0, omitidos: res.omitidos ?? 0, fallidos: res.fallidos ?? [], total: res.total ?? objetivos.length })
      setDestinoId(destino.carpetaId)
      return {}
    }
    return { error: 'Error al crear los enlaces.' }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={abrir}
        disabled={cargandoRaices || objetivos.length === 0}
        style={{ minHeight: '36px' }}
        title="Crear enlaces de lo seleccionado en otra carpeta"
      >
        {cargandoRaices ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
        {cargandoRaices ? 'Cargando…' : `Enlazar (${objetivos.length})`}
      </button>

      {isOpen && raices && typeof document !== 'undefined'
        ? createPortal(
            <div className="modal-overlay" onClick={cerrar}>
              <div
                className="modal modal-enlace"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Enlazar selección"
              >
                <div className="modal-header">
                  <h2 className="modal-title">Enlazar selección</h2>
                  <button onClick={cerrar} className="btn-ghost btn-icon" type="button" aria-label="Cerrar">
                    <X size={20} />
                  </button>
                </div>

                {resultado ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      {resultado.fallidos.length === 0 ? (
                        <CheckCircle2 size={28} style={{ color: 'var(--color-success, #4ade80)', flexShrink: 0 }} />
                      ) : (
                        <AlertTriangle size={28} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                      )}
                      <p style={{ fontSize: '0.9rem' }}>
                        <strong>{resultado.creados}</strong> de {resultado.total} enlazados
                        {resultado.omitidos > 0 && ` · ${resultado.omitidos} ya existían`}
                        {resultado.fallidos.length > 0 && ` · ${resultado.fallidos.length} fallaron`}
                      </p>
                    </div>

                    {resultado.fallidos.length > 0 && (
                      <ul style={{ fontSize: '0.8rem', color: 'var(--color-danger)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {resultado.fallidos.map((f) => (
                          <li key={f.id}>«{f.nombre}»: {f.error}</li>
                        ))}
                      </ul>
                    )}

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {destinoId && (
                        <Link
                          className="btn btn-primary"
                          href={`${basePath}?carpeta=${destinoId}`}
                          onClick={cerrarYLimpiar}
                          style={{ flex: 1, justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center' }}
                        >
                          Ir a la carpeta destino
                        </Link>
                      )}
                      <button type="button" className="btn btn-ghost" onClick={cerrarYLimpiar} style={{ flex: 1, justifyContent: 'center' }}>
                        Cerrar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
                      Se enlazarán <strong>{objetivos.length}</strong> elemento(s) sin duplicar espacio:
                      {' '}{objetivos.slice(0, 3).map((o) => `«${o.nombre}»`).join(', ')}
                      {objetivos.length > 3 && ` y ${objetivos.length - 3} más`}. Elige la carpeta destino:
                    </p>

                    <ExploradorDestino
                      raicesComun={raices.comun}
                      raicesPrivadas={raices.privadas}
                      userId={userId}
                      isAdmin={isAdmin}
                      requiereCarpeta
                      textoBoton={(_scope, nombre) => `Enlazar ${objetivos.length} en ${nombre}`}
                      onConfirmar={handleConfirmar}
                    />
                  </>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
