import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FolderHeart, Plus } from 'lucide-react'
import FileCard from '@/components/FileCard'
import UploadModalWrapper from './UploadModalWrapper' // Wrapper de cliente para el estado del modal
import StorageBar from '@/components/StorageBar'

export default async function DashboardComun() {
  const supabase = await createClient()

  // 1. Obtener usuario y rol
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', user.id)
    .single()
  
  const isAdmin = perfil?.rol === 'admin'

  // 2. Obtener archivos COMUNES (que no están en carpetas privadas, y que el estado es activo)
  // Como simplificación para la vista común, traemos todos los archivos donde la carpeta es nula 
  // o la carpeta no es privada.
  const { data: archivos } = await supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo), carpetas!inner(es_privada)')
    .eq('estado', 'activo')
    .eq('carpetas.es_privada', false)
    .order('fecha_subida', { ascending: false })

  // También archivos sin carpeta (raíz común)
  const { data: archivosRaiz } = await supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('estado', 'activo')
    .is('carpeta_id', null)
    .order('fecha_subida', { ascending: false })

  const todosArchivos = [...(archivos || []), ...(archivosRaiz || [])].sort(
    (a, b) => new Date(b.fecha_subida).getTime() - new Date(a.fecha_subida).getTime()
  )

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Área Común</h1>
          <p className="page-subtitle">Documentos visibles para toda la familia</p>
        </div>
        <UploadModalWrapper scope="comun" />
      </div>

      {isAdmin && <StorageBar isAdmin={isAdmin} />}

      {todosArchivos.length === 0 ? (
        <div className="empty-state">
          <FolderHeart size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">No hay documentos comunes</h3>
          <p className="empty-state-text">Sube el primer archivo para compartirlo con tu familia.</p>
        </div>
      ) : (
        <div className="grid-files">
          {todosArchivos.map((file) => (
            <FileCard 
              key={file.id} 
              file={file} 
              isAdmin={isAdmin} 
              isOwner={file.subido_por === user.id} 
            />
          ))}
        </div>
      )}
    </div>
  )
}
