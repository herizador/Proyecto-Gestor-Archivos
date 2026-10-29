'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, List, Trash2, X } from 'lucide-react'
import { eliminarArchivosPermanentes } from '@/actions/files'
import TrashFileCard from '@/components/TrashFileCard'
import { avisar, confirmar } from '@/components/Avisos'
import type { ArchivoConAutor } from '@/types/database'

// Mismo tope que la Server Action: evita lotes que superen el tiempo de Vercel.
const MAX_LOTE = 100

export default function PapeleraLista({
  archivos,
  isAdmin,
  userId,
}: {
  archivos: ArchivoConAutor[]
  isAdmin: boolean
  userId: string
}) {
  const [modo, setModo] = useState(false)
  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [procesando, setProcesando] = useState(false)
  const router = useRouter()

  const todos = archivos.length > 0 && seleccionados.length === archivos.length

  function alternar(id: string) {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function alternarTodos() {
    if (todos) {
      setSeleccionados([])
      return
    }
    if (archivos.length > MAX_LOTE) {
      avisar('info', `Se seleccionan los primeros ${MAX_LOTE}. Elimina el resto en otro lote.`)
      setSeleccionados(archivos.slice(0, MAX_LOTE).map((a) => a.id))
      return
    }
    setSeleccionados(archivos.map((a) => a.id))
  }

  function salir() {
    setModo(false)
    setSeleccionados([])
  }

  async function eliminarSeleccionados() {
    if (seleccionados.length === 0 || procesando) return
    const ok = await confirmar({
      titulo: 'Eliminar definitivamente',
      mensaje: `¿Eliminar ${seleccionados.length} archivo${seleccionados.length === 1 ? '' : 's'} para siempre? Esta acción no se puede deshacer.`,
      textoOk: 'Eliminar',
      peligroso: true,
    })
    if (!ok) return

    setProcesando(true)
    const res = await eliminarArchivosPermanentes(seleccionados)
    setProcesando(false)

    if ('error' in res) {
      avisar('error', res.error ?? 'No se pudieron eliminar los archivos.')
      return
    }
    if (res.eliminados > 0) {
      avisar('exito', `${res.eliminados} archivo${res.eliminados === 1 ? '' : 's'} eliminado${res.eliminados === 1 ? '' : 's'} definitivamente.`)
    }
    if (res.fallidos.length > 0) {
      avisar('error', `${res.fallidos.length} no se pudieron eliminar. Revisa la papelera.`)
    }
    salir()
    router.refresh()
  }

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {!modo ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setModo(true)}
              style={{ minHeight: '36px' }}
              title="Seleccionar varios para borrar definitivamente"
            >
              <List size={16} />
              Seleccionar
            </button>
          ) : (
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              Pulsa los archivos que quieras eliminar definitivamente.
            </span>
          )}
        </div>
      )}

      <div className="grid-files">
        {archivos.map((file) => (
          <TrashFileCard
            key={file.id}
            file={file}
            isAdmin={isAdmin}
            isOwner={file.subido_por === userId}
            seleccionable={modo}
            seleccionado={seleccionados.includes(file.id)}
            onToggle={() => alternar(file.id)}
          />
        ))}
      </div>

      {modo && typeof document !== 'undefined' && createPortal(
        <div className="pill-zona">
          <div className="pill-seleccion" role="toolbar" aria-label="Acciones de la papelera">
            <span className="pill-conteo">
              {seleccionados.length} seleccionado{seleccionados.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={alternarTodos}
              disabled={procesando}
              style={{ minHeight: '36px' }}
              title={todos ? 'Deseleccionar todo' : 'Seleccionar todo'}
            >
              <Check size={14} />
              {todos ? 'Ninguno' : 'Todos'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={eliminarSeleccionados}
              disabled={seleccionados.length === 0 || procesando}
              style={{ minHeight: '36px' }}
              title="Borra los archivos seleccionados de R2 y de la base de datos"
            >
              <Trash2 size={14} />
              {procesando ? 'Eliminando...' : 'Eliminar definitivamente'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={salir}
              disabled={procesando}
              style={{ minHeight: '36px' }}
              title="Salir del modo selección"
            >
              <X size={14} />
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
