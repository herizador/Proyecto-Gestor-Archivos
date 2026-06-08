import { obtenerEnlaceCompartido } from '@/actions/share'
import { FileText, Download, ShieldCheck, AlertTriangle, Clock } from 'lucide-react'

export default async function CompartirPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '24px' }}>
            <AlertTriangle size={48} style={{ color: 'var(--color-warning)', margin: '0 auto' }} />
          </div>
          <h1 className="login-title" style={{ marginBottom: '12px' }}>Enlace no válido</h1>
          <p className="login-subtitle">No se proporcionó un token de acceso.</p>
        </div>
      </div>
    )
  }

  const result = await obtenerEnlaceCompartido(token)

  if (result.error) {
    const isExpired = result.error === 'Este enlace ha expirado.'
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '24px' }}>
            {isExpired
              ? <Clock size={48} style={{ color: 'var(--color-warning)', margin: '0 auto' }} />
              : <AlertTriangle size={48} style={{ color: 'var(--color-danger)', margin: '0 auto' }} />
            }
          </div>
          <h1 className="login-title" style={{ marginBottom: '12px' }}>
            {isExpired ? 'Enlace expirado' : 'Enlace no válido'}
          </h1>
          <p className="login-subtitle">{result.error}</p>
        </div>
      </div>
    )
  }

  const { enlace, archivos } = result

  return (
    <div className="login-bg">
      <div style={{ width: '100%', maxWidth: '640px' }}>
        <div className="login-card" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
            <div className="sidebar-logo-icon" style={{ width: 44, height: 44 }}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="login-title" style={{ fontSize: '1.2rem' }}>Archivos Compartidos</h1>
              <p className="login-subtitle">Alguien compartió estos archivos contigo</p>
            </div>
          </div>

          {(!archivos || archivos.length === 0) ? (
            <div className="empty-state">
              <FileText size={48} className="empty-state-icon" />
              <h3 className="empty-state-title">Sin archivos disponibles</h3>
              <p className="empty-state-text">Los archivos de este enlace ya no están disponibles.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {archivos.map((archivo) => (
                <div
                  key={archivo.id}
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px' }}
                >
                  <div style={{ padding: '10px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)' }}>
                    <FileText size={20} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {archivo.nombre_original}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {(archivo.tamano_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  {archivo.url ? (
                    <a
                      href={archivo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-sm"
                      style={{ flexShrink: 0, textDecoration: 'none' }}
                    >
                      <Download size={14} /> Descargar
                    </a>
                  ) : (
                    <span className="badge badge-papelera">No disponible</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {enlace?.expiracion && (
              <p>Este enlace expira el {new Date(enlace.expiracion).toLocaleDateString('es-ES')}</p>
            )}
            <p style={{ marginTop: '4px' }}>Gestor de Archivos Familiar</p>
          </div>
        </div>
      </div>
    </div>
  )
}
