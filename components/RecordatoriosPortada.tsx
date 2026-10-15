'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Plus, Check, Trash2 } from 'lucide-react'
import { completarRecordatorio, eliminarRecordatorio } from '@/actions/recordatorios'
import RecordatorioModal from '@/components/RecordatorioModal'
import { avisar, confirmar } from '@/components/Avisos'
import type { Recordatorio } from '@/types/database'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function etiquetaVencimiento(venceEl: string): { texto: string; vencido: boolean; proximo: boolean } {
  const hoy = hoyISO()
  if (venceEl < hoy) return { texto: 'Vencido', vencido: true, proximo: false }
  const dias = Math.round((new Date(`${venceEl}T00:00:00`).getTime() - new Date(`${hoy}T00:00:00`).getTime()) / 86400000)
  if (dias === 0) return { texto: 'Vence hoy', vencido: false, proximo: true }
  if (dias === 1) return { texto: 'Vence mañana', vencido: false, proximo: true }
  if (dias <= 30) return { texto: `En ${dias} días`, vencido: false, proximo: true }
  const [y, m, d] = venceEl.split('-')
  return { texto: `${d}/${m}/${y}`, vencido: false, proximo: false }
}

// Widget de portada: próximos vencimientos + crear/marcar/borrar.
// Los avisos nunca tocan archivos: solo recuerdan renovar.
export default function RecordatoriosPortada({ iniciales }: { iniciales: Recordatorio[] }) {
  const [items, setItems] = useState<Recordatorio[]>(iniciales)
  const [modalAbierto, setModalAbierto] = useState(false)
  const router = useRouter()

  const pendientes = items.filter((r) => !r.completado).sort((a, b) => (a.vence_el < b.vence_el ? -1 : 1))
  const vencidos = pendientes.filter((r) => etiquetaVencimiento(r.vence_el).vencido).length

  async function handleCompletar(r: Recordatorio) {
    const res = await completarRecordatorio(r.id, !r.completado)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, completado: !x.completado } : x)))
    router.refresh()
  }

  async function handleEliminar(r: Recordatorio) {
    const ok = await confirmar({
      titulo: 'Eliminar recordatorio',
      mensaje: `¿Eliminar «${r.titulo}»? El archivo no se toca.`,
      textoOk: 'Eliminar',
      peligroso: true,
    })
    if (!ok) return
    const res = await eliminarRecordatorio(r.id)
    if ('error' in res && res.error) {
      avisar('error', res.error)
      return
    }
    setItems((prev) => prev.filter((x) => x.id !== r.id))
    router.refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>Próximos recordatorios</h2>
        {vencidos > 0 && (
          <span className="badge badge-papelera" style={{ marginLeft: 'auto' }}>
            {vencidos} vencido{vencidos !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
        Documentos que requieren atención (nunca se borra nada solo)
      </p>

      {pendientes.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
          Sin pendientes. Todo en orden.
        </p>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {pendientes.slice(0, 4).map((r) => {
            const et = etiquetaVencimiento(r.vence_el)
            return (
              <li
                key={r.id}
                className="card"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <button
                  type="button"
                  onClick={() => handleCompletar(r)}
                  title={r.completado ? 'Marcar pendiente' : 'Marcar hecho'}
                  aria-label={r.completado ? `Marcar pendiente ${r.titulo}` : `Marcar hecho ${r.titulo}`}
                  style={{
                    width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${et.vencido ? 'var(--color-danger)' : 'var(--color-border-hover)'}`,
                    background: 'transparent', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', color: 'var(--color-success)',
                  }}
                >
                  {r.completado && <Check size={14} />}
                </button>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.titulo}
                  </span>
                  {r.detalle && (
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.detalle}
                    </span>
                  )}
                </span>
                <span
                  className={`badge ${et.vencido ? 'badge-papelera' : et.proximo ? 'badge-privado' : 'badge-miembro'}`}
                  style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Clock size={12} /> {et.texto}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-icon"
                  onClick={() => handleEliminar(r)}
                  title="Eliminar recordatorio (el archivo no se toca)"
                  aria-label={`Eliminar recordatorio ${r.titulo}`}
                  style={{ padding: '6px', flexShrink: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setModalAbierto(true)}
        style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed', minHeight: '44px' }}
      >
        <Plus size={16} /> Añadir recordatorio
      </button>

      <RecordatorioModal
        abierto={modalAbierto}
        alCerrar={() => setModalAbierto(false)}
        onGuardado={() => router.refresh()}
      />
    </div>
  )
}
