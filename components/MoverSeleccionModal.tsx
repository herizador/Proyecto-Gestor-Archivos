'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { FolderInput, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { moverElementosBatch } from '@/actions/mover'
import { listarRaicesAcceso, type ObjetivoEnlace } from '@/actions/accesos'
import ExploradorDestino, { type DestinoElegido } from '@/components/ExploradorDestino'
import type { Carpeta } from '@/types/database'

type Resultado = {
  movidos: number
  omitidos: number
  fallidos: Array<{ id: string; nombre: string; error: string }>
  total: number
}

// Botón "Mover" del modo selección + modal: traslada N archivos/carpetas al
// destino elegido. Entre ámbitos también mueve los bytes en R2; las carpetas
// solo se mueven dentro de su ámbito. La raíz es un destino válido.
export default function MoverSeleccionModal({
  objetivos,
  basePath = '/',
  onMovidos,
}: {
  objetivos: ObjetivoEnlace[]
  basePath?: string
  onMovidos: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [raices, setRaices] = useState<{ comun: Carpeta[]; privadas: Carpeta[] } | null>(null)
  const [cargandoRaices, setCargandoRaices] = useState(false)
  const [userId, setUserId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [destinoHref, setDestinoHref] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setResultado(null)
        setDestinoHref(null)
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
        alert(res.error)
        return
      }
      setRaices({ comun: res.comun, privadas: res.privadas })
      setUserId(res.userId)
      setIsAdmin(res.isAdmin)
      setResultado(null)
      setDestinoHref(null)
      setIsOpen(true)
    } catch {
      alert('No se pudieron cargar las carpetas. Revisa tu conexión.')
    } finally {
      setCargandoRaices(false)
    }
  }

  function cerrar() {
    setIsOpen(false)
    setResultado(null)
    setDestinoHref(null)
  }

  function cerrarYLimpiar() {
    cerrar()
    onMovidos()
  }

  async function handleConfirmar(destino: DestinoElegido) {
    const res = await moverElementosBatch({
      objetivos,
      destinoCarpetaId: destino.carpetaId,
      scope: destino.scope,
    })
    if ('error' in res && res.error) {
      return { error: res.error }
    }
    if ('success' in res && res.success) {
      setResultado({ movidos: res.movidos ?? 0, omitidos: res.omitidos ?? 0, fallidos: res.fallidos ?? [], total: res.total ?? objetivos.length })
      setDestinoHref(destino.carpetaId ? `${basePath}?carpeta=${destino.carpetaId}` : basePath)
      return {}
    }
    return { error: 'Error al mover.' }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={abrir}
        disabled={cargandoRaices || objetivos.length === 0}
        style={{ minHeight: '36px' }}
        title="Mover lo seleccionado a otra carpeta"
      >
        {cargandoRaices ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />}
        {cargandoRaices ? 'Cargando…' : `Mover (${objetivos.length})`}
      </button>

      {isOpen && raices && typeof document !== 'undefined'
        ? createPortal(
            <div className="modal-overlay" onClick={cerrar}>
              <div
                className="modal modal-enlace"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Mover selección"
              >
                <div className="modal-header">
                  <h2 className="modal-title">Mover selección</h2>
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
                        <strong>{resultado.movidos}</strong> de {resultado.total} movidos
                        {resultado.omitidos > 0 && ` · ${resultado.omitidos} ya estaban ahí`}
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
                      {destinoHref && (
                        <Link
                          className="btn btn-primary"
                          href={destinoHref}
                          onClick={cerrarYLimpiar}
                          style={{ flex: 1, justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center' }}
                        >
                          Ir al destino
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
                      Se moverán <strong>{objetivos.length}</strong> elemento(s):
                      {' '}{objetivos.slice(0, 3).map((o) => `«${o.nombre}»`).join(', ')}
                      {objetivos.length > 3 && ` y ${objetivos.length - 3} más`}. Elige el destino
                      (vale la raíz de cada ámbito):
                    </p>

                    <ExploradorDestino
                      raicesComun={raices.comun}
                      raicesPrivadas={raices.privadas}
                      userId={userId}
                      isAdmin={isAdmin}
                      textoBoton={(_scope, nombre) => `Mover ${objetivos.length} a ${nombre}`}
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
