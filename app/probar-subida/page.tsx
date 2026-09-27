// TEMPORAL — diagnóstico del Share Target. Borrar cuando el share funcione.
// Prueba el mismo POST multipart de /api/recibir pero desde un formulario
// normal: si esto crea el lote y el share no, el fallo es el empaquetado
// del share-sheet de Chromium en el dispositivo, no el transporte.
export default function ProbarSubidaPage() {
  return (
    <div className="login-bg">
      <div style={{ width: '100%', maxWidth: '560px' }}>
        <div className="login-card" style={{ maxWidth: 'none' }}>
          <h1 className="login-title" style={{ fontSize: '1.2rem', marginBottom: '4px' }}>
            Prueba temporal de transporte
          </h1>
          <p className="login-subtitle" style={{ marginBottom: '20px' }}>
            Envía el mismo POST que el share del sistema. Si esto guarda y el share no,
            el problema está en el teléfono, no en el servidor.
          </p>
          <form action="/api/recibir" method="POST" encType="multipart/form-data">
            <input
              type="file"
              name="archivos"
              multiple
              className="input"
              style={{ marginBottom: '16px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ width: '100%', minHeight: '44px' }}>
              Enviar como el share
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
