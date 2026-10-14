// Se muestra al instante al navegar entre páginas del dashboard mientras
// llegan los datos del servidor (antes la página vieja quedaba congelada).
export default function CargandoDashboard() {
  return (
    <div className="page-content" aria-busy="true" aria-label="Cargando contenido">
      <div className="page-header">
        <div className="skeleton" style={{ height: '32px', width: 'min(240px, 60%)' }} />
        <div className="skeleton" style={{ height: '16px', width: 'min(180px, 45%)', marginTop: '8px' }} />
      </div>
      <div className="grid-files">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ minHeight: '110px' }} aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
