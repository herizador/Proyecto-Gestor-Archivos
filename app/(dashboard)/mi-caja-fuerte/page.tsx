import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Lock, FileX } from 'lucide-react'
import FileCard from '@/components/FileCard'
import UploadModalWrapper from '../UploadModalWrapper'

export default async function CajaFuertePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  
  const isAdmin = perfil?.rol === 'admin'

  // Archivos privados (sin carpeta o en carpetas marcadas como privadas)
  // Como simplificación de UI, la subida privada no tiene carpeta asociada por ahora, 
  // así que filtramos los que subió este usuario, y que su rutaR2 diga "privado"
  // (La lógica real de negocio usaría carpetas, pero para esta demo usamos el subido_por)
  const { data: archivos } = await supabase
    .from('archivos')
    .select('*, subido_por_perfil:perfiles(nombre_completo)')
    .eq('subido_por', user.id)
    .like('ruta_r2', '%/privado/%')
    .order('fecha_subida', { ascending: false })

  return (
    <div className="page-content animate-fade-in">
      <div className="safe-header">
        <div className="safe-icon">
          <Lock size={28} />
        </div>
        <div>
          <h1 className="page-title" style={{ fontSize: '1.4rem' }}>Mi Caja Fuerte</h1>
          <p className="page-subtitle">Nadie más de tu familia puede ver estos archivos.</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <UploadModalWrapper scope="privado" />
        </div>
      </div>

      {!archivos || archivos.length === 0 ? (
        <div className="empty-state">
          <FileX size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Caja Fuerte Vacía</h3>
          <p className="empty-state-text">Aquí aparecerán los archivos que subas como privados.</p>
        </div>
      ) : (
        <div className="grid-files">
          {archivos.map((file) => (
            <FileCard 
              key={file.id} 
              file={file} 
              isAdmin={isAdmin} 
              isOwner={true} 
            />
          ))}
        </div>
      )}
    </div>
  )
}
