'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud } from 'lucide-react'
import ExploradorDestino, { type DestinoElegido } from '@/components/ExploradorDestino'
import { getUploadUrl, registrarArchivo } from '@/actions/files'
import type { Carpeta } from '@/types/database'

const MAX_MANUAL = 10 // mismo tope que el Share Target

// Plan B cuando el Web Share Target no entrega el archivo (iOS no lo soporta
// y algunos Android lo bloquean): el usuario elige los ficheros con el
// selector nativo del móvil y se suben por el flujo normal (URL pre-firmada
// directa a R2 + registro en BD), sin pasar por el staging de /api/recibir.
export default function GuardadoManual({
  raicesComun,
  raicesPrivadas,
  userId,
  isAdmin,
}: {
  raicesComun: Carpeta[]
  raicesPrivadas: Carpeta[]
  userId: string
  isAdmin: boolean
}) {
  const [ficheros, setFicheros] = useState<File[]>([])
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const router = useRouter()

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const lista = e.target.files ? [...e.target.files] : []
    setFicheros(lista.slice(0, MAX_MANUAL))
    setErrorLocal(lista.length > MAX_MANUAL ? `Solo se guardan los primeros ${MAX_MANUAL}.` : null)
  }

  async function handleConfirmar(destino: DestinoElegido) {
    if (ficheros.length === 0) return { error: 'Elige primero uno o varios archivos con el botón de arriba.' }
    setErrorLocal(null)
    const scope = destino.scope === 'privado' ? 'privado' : 'comun'
    let guardados = 0
    try {
      for (const f of ficheros) {
        const up = await getUploadUrl({
          fileName: f.name,
          contentType: f.type || 'application/octet-stream',
          fileSize: f.size,
          carpetaId: destino.carpetaId,
          scope,
        })
        if ('error' in up && up.error) throw new Error(up.error)
        if (!('uploadUrl' in up) || !up.uploadUrl || !up.key) throw new Error('No se pudo preparar la subida.')
        // Subida directa navegador → R2: solo Content-Type, como en UploadModal
        const r = await fetch(up.uploadUrl, {
          method: 'PUT',
          body: f,
          headers: { 'Content-Type': f.type || 'application/octet-stream' },
          credentials: 'omit',
        })
        if (!r.ok) throw new Error(`Falló la subida de «${f.name}».`)
        const reg = await registrarArchivo({
          nombreOriginal: f.name,
          rutaR2: up.key,
          tamanoBytes: f.size,
          tipoMime: f.type || 'application/octet-stream',
          carpetaId: destino.carpetaId,
        })
        if ('error' in reg && reg.error) throw new Error(reg.error)
        guardados += 1
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Error al subir.'
      if (m.includes('LIMITE_ALMACENAMIENTO')) {
        const msg = 'El almacenamiento familiar ha alcanzado el límite de 9 GB.'
        setErrorLocal(msg)
        return { error: msg }
      }
      setErrorLocal(m)
      return { error: m }
    }
    const qs = new URLSearchParams({ ok: '1', guardados: String(guardados), total: String(ficheros.length), scope })
    if (destino.carpetaId) qs.set('carpeta', destino.carpetaId)
    router.replace(`/recibir?${qs.toString()}`)
    return {}
  }

  return (
    <div style={{ marginTop: '20px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
      <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '4px' }}>Subir manualmente desde el móvil</p>
      <p className="login-subtitle" style={{ marginBottom: '12px' }}>
        Si el sistema no entregó el archivo, elígelo aquí directamente (funciona en iPhone y Android).
      </p>

      <label
        className="dropzone"
        htmlFor="guardadoManualInput"
        style={{ display: 'block', padding: '24px 16px', marginBottom: '12px' }}
      >
        <UploadCloud size={32} className="dropzone-icon" />
        {ficheros.length > 0 ? (
          <p className="dropzone-text">
            <strong>{ficheros.length} archivo(s) elegido(s)</strong>
            <br />
            <small>{ficheros.map((f) => f.name).join(', ')}</small>
          </p>
        ) : (
          <p className="dropzone-text">
            Toca para elegir archivos del móvil<br /><small>Máximo 20 MB por archivo, hasta {MAX_MANUAL}</small>
          </p>
        )}
        <input
          type="file"
          id="guardadoManualInput"
          style={{ display: 'none' }}
          multiple
          onChange={onPick}
        />
      </label>

      {errorLocal && (
        <div className="error-msg" style={{ marginBottom: '12px' }}>
          <span>{errorLocal}</span>
        </div>
      )}

      <ExploradorDestino
        raicesComun={raicesComun}
        raicesPrivadas={raicesPrivadas}
        userId={userId}
        isAdmin={isAdmin}
        textoBoton={(scope, destinoNombre) =>
          ficheros.length === 0
            ? 'Elige archivos para subir'
            : `Subir ${ficheros.length} aquí: ${scope === 'comun' ? 'Área común' : 'Mi caja fuerte'} · ${destinoNombre}`}
        onConfirmar={handleConfirmar}
      />
    </div>
  )
}
