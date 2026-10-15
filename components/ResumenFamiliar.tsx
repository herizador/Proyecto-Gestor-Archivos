import { HardDrive, Files, Users } from 'lucide-react'

function formatoCorto(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

// Tarjeta resumen del espacio familiar (estilo Figma, en oscuro): progreso del
// cupo + conteos. Solo lectura; los números los calcula la página servidora.
export default function ResumenFamiliar({
  usoBytes,
  limiteBytes,
  archivos,
  miembros,
}: {
  usoBytes: number
  limiteBytes: number
  archivos: number
  miembros: number
}) {
  const pct = limiteBytes > 0 ? Math.min(100, Math.round((usoBytes / limiteBytes) * 100)) : 0
  return (
    <section className="card" aria-label="Resumen de almacenamiento" style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', padding: '20px 24px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '200px', flex: '1 1 220px' }}>
        <div style={{ padding: '10px', background: 'var(--color-accent-dim)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)', flexShrink: 0 }}>
          <HardDrive size={22} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Almacenamiento familiar</p>
          <p style={{ fontWeight: 700, whiteSpace: 'nowrap' }} title={`${usoBytes.toLocaleString('es-ES')} bytes usados`}>
            {formatoCorto(usoBytes)} <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>de {formatoCorto(limiteBytes)}</span>
          </p>
        </div>
      </div>
      <div style={{ flex: '2 1 240px', minWidth: '160px' }}>
        <div className="storage-bar-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Uso de almacenamiento">
          <div className={`storage-bar-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px', textAlign: 'right' }}>{pct}%</p>
      </div>
      <div style={{ display: 'flex', gap: '20px', flexShrink: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '1.05rem' }}>
            <Files size={16} style={{ color: 'var(--color-text-muted)' }} /> {archivos}
          </p>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Archivos</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '1.05rem' }}>
            <Users size={16} style={{ color: 'var(--color-text-muted)' }} /> {miembros}
          </p>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Miembros</p>
        </div>
      </div>
    </section>
  )
}
