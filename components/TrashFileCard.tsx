'use client'

import { FileText, Image, RefreshCw, Trash2 } from 'lucide-react'
import { ArchivoConAutor } from '@/types/database'
import { restaurarArchivo, eliminarArchivoPermanente } from '@/actions/files'
import MenuAcciones, { type ItemMenu } from '@/components/MenuAcciones'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DateDisplay from '@/components/DateDisplay'
import { avisar, confirmar } from '@/components/Avisos'

export default function TrashFileCard({
  file,
  isAdmin,
  isOwner,
}: {
  file: ArchivoConAutor
  isAdmin: boolean
  isOwner: boolean
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const isImage = file.tipo_mime.startsWith('image/')
  const sizeKb = (file.tamano_bytes / 1024).toFixed(1)

  async function handleRestore() {
    setLoading(true)
    const result = await restaurarArchivo(file.id)
    setLoading(false)
    if (result.error) {
      avisar('error', result.error)
    } else {
      avisar('exito', 'Archivo restaurado.')
      router.refresh()
    }
  }

  async function handlePermanentDelete() {
    const ok = await confirmar({
      titulo: 'Eliminar para siempre',
      mensaje: '¿Eliminar permanentemente este archivo? Esta acción no se puede deshacer.',
      textoOk: 'Eliminar',
      peligroso: true,
    })
    if (!ok) return

    setLoading(true)
    const result = await eliminarArchivoPermanente(file.id)
    setLoading(false)
    if (result.error) {
      avisar('error', result.error)
    } else {
      avisar('exito', 'Archivo eliminado permanentemente.')
      router.refresh()
    }
  }

  const canManage = isAdmin || isOwner

  const itemsMenu: ItemMenu[] = [
    { icono: <RefreshCw size={16} />, texto: 'Restaurar', onClick: handleRestore, deshabilitado: loading },
    ...(isAdmin
      ? [{
          icono: <Trash2 size={16} />,
          texto: 'Eliminar permanentemente',
          peligroso: true,
          onClick: handlePermanentDelete,
          deshabilitado: loading,
        }]
      : []),
  ]

  return (
    <div className="card card-hover" style={{ display: 'flex', flexDirection: 'column', padding: '16px', position: 'relative' }}>
      {canManage && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 5 }}>
          <MenuAcciones items={itemsMenu} etiqueta={`Acciones de ${file.nombre_original}`} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: 0, paddingRight: canManage ? '40px' : 0 }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)' }}>
          {isImage ? <Image size={24} /> : <FileText size={24} />}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {file.nombre_original}
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {sizeKb} KB • Eliminado {file.fecha_papelera ? <DateDisplay date={file.fecha_papelera} /> : '—'}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '2px' }}>
            Por: {file.subido_por_perfil?.nombre_completo || 'Desconocido'}
          </p>
          {!canManage && (
            <span className="badge badge-papelera" style={{ marginTop: '8px' }}>
              En Papelera
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
