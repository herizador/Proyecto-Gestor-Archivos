import { createClient } from '@/lib/supabase/server'
import AperturaSistema from '@/components/AperturaSistema'
import type { Carpeta } from '@/types/database'
import { FolderInput, AlertTriangle } from 'lucide-react'

// Destino del File Handling ("Abrir con Gestor Familiar" desde el explorador).
// Ruta pública como /recibir: una redirección a /login perdería los ficheros;
// la sesión se valida aquí y sin sesión se avisa (hay que reabrir tras entrar).
export default async function AbrirPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Sesión requerida</h1>
          <p className="login-subtitle">
            Inicia sesión para guardar lo abierto desde tu dispositivo. Ten en cuenta que el archivo
            se pierde al cambiar de pantalla: vuelve a abrirlo con Gestor Familiar tras entrar.
          </p>
          <a className="btn btn-primary" href="/login" style={{ marginTop: '16px', textDecoration: 'none' }}>
            Ir al login
          </a>
        </div>
      </div>
    )
  }

  const [{ data: raicesComun }, { data: raicesPrivadas }, { data: perfil }] = await Promise.all([
    supabase.from('carpetas').select('*').eq('es_privada', false).is('carpeta_padre_id', null).order('fecha_creacion'),
    supabase.from('carpetas').select('*').eq('es_privada', true).eq('creado_por', user.id).is('carpeta_padre_id', null).order('fecha_creacion'),
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
  ])

  return (
    <div className="login-bg">
      <div style={{ width: '100%', maxWidth: '560px' }}>
        <div className="login-card" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <FolderInput size={22} style={{ color: 'var(--color-accent)' }} />
            <h1 className="login-title" style={{ fontSize: '1.2rem' }}>Guardar en Gestor Familiar</h1>
          </div>
          <p className="login-subtitle" style={{ marginBottom: '20px' }}>Archivo abierto desde tu dispositivo</p>
          <AperturaSistema
            raicesComun={(raicesComun ?? []) as Carpeta[]}
            raicesPrivadas={(raicesPrivadas ?? []) as Carpeta[]}
            userId={user.id}
            isAdmin={perfil?.rol === 'admin'}
          />
        </div>
      </div>
    </div>
  )
}
