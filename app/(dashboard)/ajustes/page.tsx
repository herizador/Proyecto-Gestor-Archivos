import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import TokensDav from '@/components/TokensDav'
import { listarTokensDav } from '@/actions/dav'

export default async function AjustesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'

  const { data: tokens, error } = await listarTokensDav()
  if (error) console.error('[Ajustes] listarTokensDav:', error)

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Tu espacio / Ajustes</p>
        <h1 className="page-title">Ajustes</h1>
        <p className="page-subtitle">Conecta tus dispositivos y revisa tus accesos</p>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Settings size={20} style={{ color: 'var(--color-accent)' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Explorador de Windows (WebDAV)</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Crea una contraseña de Explorador por dispositivo y conéctala como unidad de red
          para abrir tus archivos sin descargarlos. Si pierdes un dispositivo, revoca su
          token desde aquí.
        </p>
        <TokensDav iniciales={tokens ?? []} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
