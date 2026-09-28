'use client'

import { useState } from 'react'
import { Link2, X, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { crearAcceso, listarRaicesAcceso } from '@/actions/accesos'
import ExploradorDestino, { type DestinoElegido } from '@/components/ExploradorDestino'
import type { Carpeta } from '@/types/database'

// Botón "Enlace" + modal: crea un acceso directo al archivo/carpeta indicado
// en la carpeta que se elija. No duplica bytes (apunta al original).
export default function NuevoAccesoModal({
  objetivoTipo,
  objetivoId,
  objetivoNombre,
}: {
  objetivoTipo: 'archivo' | 'carpeta'
  objetivoId: string
  objetivoNombre: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [raices, setRaices] = useState<{ comun: Carpeta[]; privadas: Carpeta[] } | null>(null)
  const [cargandoRaices, setCargandoRaices] = useState(false)
  const [nombre, setNombre] = useState('')
  const [userId, setUserId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const router = useRouter()

  async function abrir() {
    setCargandoRaices(true)
    // Las raíces se cargan al abrir (sin useEffect): RLS ya filtra lo visible
    const res = await listarRaicesAcceso()
    setCargandoRaices(false)
    if ('error' in res) return
    setRaices({
      comun: res.comun,
      privadas: res.privadas,
    })
    setUserId(res.userId)
    setIsAdmin(res.isAdmin)
    setIsOpen(true)
  }

  async function handleConfirmar(destino: DestinoElegido) {
    if (!destino.carpetaId) return { error: 'Elige una carpeta de destino.' }
    const res = await crearAcceso({
      objetivoTipo,
      objetivoId,
      carpetaContenedoraId: destino.carpetaId,
      nombrePersonalizado: nombre.trim() || null,
    })
    if ('success' in res && res.success) {
      setIsOpen(false)
      setNombre('')
      router.refresh()
      return {}
    }
    return { error: ('error' in res ? res.error : 'Error al crear el enlace.') ?? 'Error al crear el enlace.' }
  }

  return (
    <>
      <button
        className="btn btn-ghost btn-action"
        onClick={abrir}
        disabled={cargandoRaices}
        title="Crear acceso directo en otra carpeta"
        type="button"
      >
        {cargandoRaices ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} <span>Enlace</span>
      </button>

      {isOpen && raices && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Crear enlace</h2>
              <button onClick={() => setIsOpen(false)} className="btn-ghost btn-icon" type="button">
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
              Enlazar «{objetivoNombre}» sin duplicar espacio. Elige la carpeta destino:
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label className="input-label" htmlFor="nombreEnlace">
                Nombre personalizado (opcional)
              </label>
              <input
                id="nombreEnlace"
                type="text"
                className="input"
                placeholder={objetivoNombre}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <ExploradorDestino
              raicesComun={raices.comun}
              raicesPrivadas={raices.privadas}
              userId={userId}
              isAdmin={isAdmin}
              requiereCarpeta
              textoBoton={(_scope, destinoNombre) => `Crear enlace en ${destinoNombre}`}
              onConfirmar={handleConfirmar}
            />
          </div>
        </div>
      )}
    </>
  )
}
