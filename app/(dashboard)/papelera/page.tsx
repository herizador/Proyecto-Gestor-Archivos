import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import TrashFileCard from '@/components/TrashFileCard'

export default async function PapeleraPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Perfil y papelera en paralelo (antes en serie)
  const [perfilRes, archivosRes] = await Promise.all([
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
    supabase
      .from('archivos')
      .select('*, subido_por_perfil:perfiles(nombre_completo)')
      .eq('estado', 'papelera')
      .order('fecha_papelera', { ascending: false }),
  ])

  const isAdmin = perfilRes.data?.rol === 'admin'
  const archivos = archivosRes.data ?? []

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)' }}>
          <Trash2 size={28} />
        </div>
        <div>
          <p className="eyebrow">Espacio familiar / Papelera</p>
          <h1 className="page-title">Papelera de Reciclaje</h1>
          <p className="page-subtitle">Archivos eliminados que puedes restaurar o borrar definitivamente.</p>
        </div>
      </div>

      {!archivos || archivos.length === 0 ? (
        <div className="empty-state">
          <Trash2 size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Papelera vacía</h3>
          <p className="empty-state-text">Los archivos que muevas a la papelera aparecerán aquí.</p>
        </div>
      ) : (
        <div className="grid-files">
          {archivos.map((file) => (
            <TrashFileCard
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
