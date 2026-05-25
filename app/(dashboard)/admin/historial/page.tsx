import { createClient } from '@/lib/supabase/server'
import { ShieldAlert, History } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default async function HistorialPage() {
  const supabase = await createClient()

  const { data: historial } = await supabase
    .from('historial_actividad')
    .select('*, perfiles(nombre_completo)')
    .order('fecha_evento', { ascending: false })
    .limit(100)

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ padding: '12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)' }}>
          <ShieldAlert size={28} />
        </div>
        <div>
          <h1 className="page-title">Historial de Actividad</h1>
          <p className="page-subtitle">Auditoría global. Esta bitácora es inmutable.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Detalles</th>
            </tr>
          </thead>
          <tbody>
            {historial?.map((evento) => (
              <tr key={evento.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {format(new Date(evento.fecha_evento), "dd/MM/yyyy HH:mm:ss", { locale: es })}
                </td>
                <td>
                  <strong>{evento.perfiles?.nombre_completo || 'Sistema'}</strong>
                </td>
                <td>
                  <span className={`badge ${
                    evento.accion.includes('ELIMINAR') || evento.accion.includes('PAPELERA') ? 'badge-papelera' :
                    evento.accion === 'LOGIN' ? 'badge-admin' : 'badge-activo'
                  }`}>
                    {evento.accion}
                  </span>
                </td>
                <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {evento.detalles ? (
                    <pre style={{ margin: 0, fontFamily: 'inherit' }}>
                      {JSON.stringify(evento.detalles, null, 2)}
                    </pre>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
            {(!historial || historial.length === 0) && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
                  <History size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  Aún no hay registros en la bitácora
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
