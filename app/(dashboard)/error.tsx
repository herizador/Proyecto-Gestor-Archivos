'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Frontera de error del dashboard: si una vista falla al renderizar (una consulta
// rota, un dato inesperado), el usuario ve un aviso claro con reintento en vez de
// una página en blanco. El 503 del service worker no llega aquí: se muestra en su
// propia pantalla offline.
export default function ErrorDashboard({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard] error de render:', error)
  }, [error])

  return (
    <div className="page-content">
      <div className="card" style={{ padding: '32px 28px', textAlign: 'center' }}>
        <AlertTriangle size={40} style={{ color: 'var(--color-danger, #d92d20)', margin: '0 auto 12px' }} />
        <h1 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px' }}>
          No se pudo cargar esta pantalla
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '20px' }}>
          Puede ser un fallo puntual de conexión. Vuelve a intentarlo; si sigue
          pasando, recarga la página.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          <RotateCcw size={16} /> Reintentar
        </button>
        {error.digest && (
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '16px' }}>
            Código de error: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
