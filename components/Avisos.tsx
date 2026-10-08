'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, Info, X, AlertOctagon } from 'lucide-react'

export type TipoAviso = 'exito' | 'error' | 'info'

type Aviso = { id: number; tipo: TipoAviso; mensaje: string }

type PeticionConfirm = {
  titulo: string
  mensaje: string
  textoOk: string
  textoCancelar: string
  peligroso: boolean
  resolver: (valor: boolean) => void
}

let secuencia = 1
const oyentesAviso = new Set<(a: Aviso) => void>()
const oyentesConfirm = new Set<(p: PeticionConfirm | null) => void>()

// Toast no bloqueante (sustituye a alert()). Si el host no está montado,
// cae a alert() para que ningún error se pierda en silencio.
export function avisar(tipo: TipoAviso, mensaje: string) {
  if (oyentesAviso.size === 0 && typeof window !== 'undefined') {
    alert(mensaje)
    return
  }
  const aviso: Aviso = { id: secuencia++, tipo, mensaje }
  oyentesAviso.forEach((fn) => fn(aviso))
}

// Confirmación propia (sustituye a confirm()). Resuelve true/false.
export function confirmar(opciones: {
  titulo: string
  mensaje: string
  textoOk?: string
  textoCancelar?: string
  peligroso?: boolean
}): Promise<boolean> {
  if (oyentesConfirm.size === 0 && typeof window !== 'undefined') {
    return Promise.resolve(confirm(opciones.mensaje))
  }
  return new Promise((resolver) => {
    const peticion: PeticionConfirm = {
      titulo: opciones.titulo,
      mensaje: opciones.mensaje,
      textoOk: opciones.textoOk ?? 'Confirmar',
      textoCancelar: opciones.textoCancelar ?? 'Cancelar',
      peligroso: opciones.peligroso ?? false,
      resolver,
    }
    oyentesConfirm.forEach((fn) => fn(peticion))
  })
}

const ICONOS: Record<TipoAviso, typeof Info> = {
  exito: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

// Host único: montado en app/layout.tsx para que sirva en toda la app.
export function AvisosHost() {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [peticion, setPeticion] = useState<PeticionConfirm | null>(null)

  useEffect(() => {
    function onAviso(a: Aviso) {
      setAvisos((prev) => [...prev.slice(-2), a])
      const ms = a.tipo === 'error' ? 5000 : 3000
      setTimeout(() => {
        setAvisos((prev) => prev.filter((x) => x.id !== a.id))
      }, ms)
    }
    function onConfirm(p: PeticionConfirm | null) {
      setPeticion(p)
    }
    oyentesAviso.add(onAviso)
    oyentesConfirm.add(onConfirm)
    return () => {
      oyentesAviso.delete(onAviso)
      oyentesConfirm.delete(onConfirm)
    }
  }, [])

  function responder(valor: boolean) {
    peticion?.resolver(valor)
    setPeticion(null)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      {avisos.length > 0 && (
        <div className="avisos-lista" role="status" aria-live="polite">
          {avisos.map((a) => {
            const Icono = ICONOS[a.tipo]
            return (
              <div key={a.id} className={`aviso aviso-${a.tipo}`}>
                <Icono size={18} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{a.mensaje}</span>
                <button
                  type="button"
                  className="btn-ghost btn-icon"
                  onClick={() => setAvisos((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label="Cerrar aviso"
                  style={{ padding: '4px', flexShrink: 0 }}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {peticion && (
        <div className="modal-overlay" style={{ zIndex: 390 }} onClick={() => responder(false)}>
          <div
            className="modal modal-sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') responder(false)
            }}
            role="alertdialog"
            aria-modal="true"
            aria-label={peticion.titulo}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <AlertOctagon size={22} style={{ color: peticion.peligroso ? 'var(--color-danger)' : 'var(--color-warning)', flexShrink: 0 }} />
              <h2 className="modal-title">{peticion.titulo}</h2>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-subtle)', marginBottom: '20px' }}>
              {peticion.mensaje}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={() => responder(false)} autoFocus>
                {peticion.textoCancelar}
              </button>
              <button
                type="button"
                className={`btn ${peticion.peligroso ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => responder(true)}
              >
                {peticion.textoOk}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
