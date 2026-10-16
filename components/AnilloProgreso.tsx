// Anillo de progreso (Figma en oscuro): SVG con solo stroke, sin librerías.
export default function AnilloProgreso({ pct, tamano = 64 }: { pct: number; tamano?: number }) {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  const radio = (tamano - 10) / 2
  const circunferencia = 2 * Math.PI * radio
  const color = p >= 90 ? 'var(--color-danger)' : p >= 70 ? 'var(--color-warning)' : 'var(--color-accent)'
  const centro = tamano / 2
  return (
    <span
      style={{ position: 'relative', width: tamano, height: tamano, flexShrink: 0 }}
      role="img"
      aria-label={`${p}% usado`}
    >
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} aria-hidden="true">
        <circle cx={centro} cy={centro} r={radio} fill="none" stroke="var(--color-surface-3)" strokeWidth={8} />
        <circle
          cx={centro}
          cy={centro}
          r={radio}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * circunferencia} ${circunferencia}`}
          transform={`rotate(-90 ${centro} ${centro})`}
        />
      </svg>
      <span
        style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 700,
        }}
      >
        {p}%
      </span>
    </span>
  )
}
