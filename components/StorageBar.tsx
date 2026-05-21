'use client'

import { useEffect, useState } from 'react'
import { getStorageUsage } from '@/actions/files'
import { Server } from 'lucide-react'

const LIMIT_GB = 9
const LIMIT_BYTES = LIMIT_GB * 1024 * 1024 * 1024

export default function StorageBar({ isAdmin }: { isAdmin: boolean }) {
  const [usage, setUsage] = useState<number | null>(null)

  useEffect(() => {
    getStorageUsage().then(setUsage)
  }, [])

  if (usage === null) return null

  const percentage = Math.min((usage / LIMIT_BYTES) * 100, 100)
  const gbUsed = (usage / (1024 * 1024 * 1024)).toFixed(2)

  let statusClass = ''
  if (percentage > 90) statusClass = 'danger'
  else if (percentage > 75) statusClass = 'warning'

  return (
    <div className="card storage-bar-wrap" style={{ marginBottom: '24px' }}>
      <div className="storage-bar-label">
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Server size={14} /> Almacenamiento Familiar
        </span>
        <span>{gbUsed} GB de {LIMIT_GB} GB</span>
      </div>
      <div className="storage-bar-track">
        <div className={`storage-bar-fill ${statusClass}`} style={{ width: `${percentage}%` }} />
      </div>
      {percentage > 90 && (
        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--color-danger)' }}>
          ⚠️ Capacidad casi llena. Límite: {LIMIT_GB} GB.
        </div>
      )}
    </div>
  )
}
