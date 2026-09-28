'use client'

import { useRouter } from 'next/navigation'
import ExploradorDestino, { type DestinoElegido } from '@/components/ExploradorDestino'
import { confirmarGuardado } from '@/actions/recibir'
import type { Carpeta, FicheroEnLote } from '@/types/database'

// Selector de destino para lotes del Share Target (página /recibir).
// La navegación vive en ExploradorDestino; aquí solo el resumen del lote
// y la confirmación con salida a la pantalla ?ok= (superviviente a refrescos).
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
  const router = useRouter()

  async function handleConfirmar(destino: DestinoElegido) {
    const res = await confirmarGuardado({ loteId, scope: destino.scope, carpetaDestinoId: destino.carpetaId })
    if ('success' in res && res.success) {
      const total = (res as { total?: number }).total ?? ficheros.length
      const n = (res as { guardados?: number }).guardados ?? total
      const qs = new URLSearchParams({ ok: '1', guardados: String(n), total: String(total), scope: destino.scope })
      if (destino.carpetaId) qs.set('carpeta', destino.carpetaId)
      router.replace(`/recibir?${qs.toString()}`)
      return {}
    }
    return { error: ('error' in res ? res.error : 'Error al guardar.') ?? 'Error al guardar.' }
  }

  return (
    <div>
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

      <ExploradorDestino
        raicesComun={raicesComun}
        raicesPrivadas={raicesPrivadas}
        userId={userId}
        isAdmin={isAdmin}
        textoBoton={(scope, destinoNombre) =>
          `Guardar en ${scope === 'comun' ? 'Área común' : 'Mi caja fuerte'} · ${destinoNombre}`}
        onConfirmar={handleConfirmar}
      />
    </div>
  )
}
