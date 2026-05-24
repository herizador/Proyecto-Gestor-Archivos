'use client'

import { useState } from 'react'
import { UploadCloud, X, Loader2 } from 'lucide-react'
import { getUploadUrl, registrarArchivo } from '@/actions/files'

export default function UploadModal({ 
  isOpen, 
  onClose, 
  carpetaId = null,
  scope = 'comun' 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  carpetaId?: string | null,
  scope?: 'comun' | 'publico' | 'privado'
}) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setError(null)

    const contentType = file.type || 'application/octet-stream'

    // 1. Pedir URL pre-firmada al servidor
    const { uploadUrl, key, error: urlError } = await getUploadUrl({
      fileName: file.name,
      contentType,
      fileSize: file.size,
      carpetaId,
      scope,
    })

    if (urlError || !uploadUrl || !key) {
      setError(urlError || 'Error al solicitar subida')
      setLoading(false)
      return
    }

    try {
      // 2. Subir directamente a Cloudflare R2 (solo headers incluidos en la firma)
      const r2Response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
        credentials: 'omit',
      })

      if (!r2Response.ok) {
        throw new Error('Error al subir a R2')
      }

      // 3. Registrar en BD y crear Audit Log
      const { error: dbError } = await registrarArchivo({
        nombreOriginal: file.name,
        rutaR2: key,
        tamanoBytes: file.size,
        tipoMime: contentType,
        carpetaId,
      })

      if (dbError) {
        setError(dbError)
        setLoading(false)
        return
      }

      // Éxito
      setFile(null)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    }
    setLoading(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Subir Documento</h2>
          <button onClick={onClose} className="btn-ghost btn-icon"><X size={20} /></button>
        </div>
        
        {error && (
          <div className="error-msg" style={{ marginBottom: '16px' }}>
            <span>{error}</span>
          </div>
        )}

        <div className="dropzone" onClick={() => document.getElementById('fileInput')?.click()}>
          <UploadCloud size={48} className="dropzone-icon" />
          {file ? (
            <p className="dropzone-text"><strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>
          ) : (
            <p className="dropzone-text">Haz clic para seleccionar un archivo<br/><small>Máximo 20 MB</small></p>
          )}
          <input 
            type="file" 
            id="fileInput" 
            style={{ display: 'none' }} 
            onChange={(e) => setFile(e.target.files?.[0] || null)} 
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={!file || loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Subir Archivo'}
          </button>
        </div>
      </div>
    </div>
  )
}
