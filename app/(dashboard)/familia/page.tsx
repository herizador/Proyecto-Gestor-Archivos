import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Users, UserCircle, FolderOpen, FileText } from 'lucide-react'

type Supa = Awaited<ReturnType<typeof createClient>>

// Solo lo público del miembro: carpetas no privadas + archivos activos en esas
// carpetas o en la raíz común. Misma definición que la página de detalle.
async function resumenMiembro(supabase: Supa, miembroId: string) {
  const { data: carpetasPub } = await supabase
    .from('carpetas')
    .select('id')
    .eq('creado_por', miembroId)
    .eq('es_privada', false)
  const ids = (carpetasPub ?? []).map((c) => c.id)

  const enCarpetas = ids.length > 0
    ? supabase
      .from('archivos')
      .select('id', { count: 'exact', head: true })
      .eq('subido_por', miembroId)
      .eq('estado', 'activo')
      .in('carpeta_id', ids)
    : Promise.resolve({ count: 0 })
  const enRaiz = supabase
    .from('archivos')
    .select('id', { count: 'exact', head: true })
    .eq('subido_por', miembroId)
    .eq('estado', 'activo')
    .is('carpeta_id', null)
    .like('ruta_r2', 'comun/%')

  const [a, b] = await Promise.all([enCarpetas, enRaiz])
  return { carpetas: ids.length, archivos: (a.count ?? 0) + (b.count ?? 0) }
}

export default async function FamiliaPage() {
  const supabase = await createClient()

  // Lista todos los miembros de la familia
  const { data: perfiles } = await supabase
    .from('perfiles')
    .select('*')
    .order('nombre_completo', { ascending: true })

  const miembros = perfiles ?? []
  const resumenes = await Promise.all(miembros.map((m) => resumenMiembro(supabase, m.id)))
  const porId = new Map(resumenes.map((r, i) => [miembros[i].id, r]))

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Mi familia</p>
        <h1 className="page-title">Mi Familia</h1>
        <p className="page-subtitle">Toca un miembro para ver sus archivos públicos.</p>
      </div>

      {miembros.length === 0 ? (
        <div className="empty-state">
          <Users size={64} className="empty-state-icon" />
          <h3 className="empty-state-title">Sin miembros</h3>
          <p className="empty-state-text">Todavía no hay nadie más en la familia.</p>
        </div>
      ) : (
        <div className="grid-members">
          {miembros.map((perfil) => {
            const r = porId.get(perfil.id) ?? { carpetas: 0, archivos: 0 }
            return (
              <Link
                key={perfil.id}
                href={`/familia/${perfil.id}`}
                className="card card-hover"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '24px 16px', minWidth: 0 }}
              >
                <div className="avatar avatar-lg" style={{ marginBottom: '16px' }}>
                  {perfil.nombre_completo?.charAt(0).toUpperCase() || <UserCircle size={32} />}
                </div>
                <h3
                  title={perfil.nombre_completo}
                  style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {perfil.nombre_completo}
                </h3>
                <span className={`badge ${perfil.rol === 'admin' ? 'badge-admin' : 'badge-miembro'}`} style={{ marginTop: '8px' }}>
                  {perfil.rol}
                </span>
                <p style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <FolderOpen size={14} /> {r.carpetas}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <FileText size={14} /> {r.archivos}
                  </span>
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
