import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Files, Users, Clock, HardDrive, Folder, ArrowRight, ShieldCheck } from 'lucide-react'
import RecordatoriosPortada from '@/components/RecordatoriosPortada'
import AnilloProgreso from '@/components/AnilloProgreso'
import { formatoCorto } from '@/lib/formatos'
import { listarRecordatorios } from '@/actions/recordatorios'
import { listarActividadReciente } from '@/actions/storage'
import type { HistorialConPerfil } from '@/types/database'

const LIMITE_BYTES = 9663676416 // 9 GB, como el trigger y el Worker
const DIA_MS = 24 * 60 * 60 * 1000

function saludo(): string {
  const h = Number(new Date().toLocaleString('es-ES', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }))
  if (h >= 7 && h < 13) return 'Buenos días'
  if (h >= 13 && h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

function haceCuanto(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `Hace ${horas} h`
  if (horas < 48) return 'Ayer'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

function describir(a: HistorialConPerfil, miId: string): { titulo: string; detalle?: string } | null {
  const d = (a.detalles ?? {}) as unknown as Record<string, string | undefined>
  const accion: string = a.accion
  const mio = a.usuario_id === miId
  const autor = mio ? 'Tú' : (a.perfiles?.nombre_completo?.split(' ')[0] ?? 'Alguien')
  const conj = (primera: string, tercera: string) => (mio ? primera : tercera)
  switch (a.accion) {
    case 'LOGIN':
    case 'LOGOUT':
      return null
    case 'SUBIR_ARCHIVO':
      return { titulo: `${autor} ${conj('subiste', 'subió')} un archivo`, detalle: d.nombre_original }
    case 'VISUALIZAR_ARCHIVO':
      return { titulo: `${autor} ${conj('viste', 'vio')} un archivo`, detalle: d.nombre_original }
    case 'DESCARGAR_ARCHIVO':
      return { titulo: `${autor} ${conj('descargaste', 'descargó')} un archivo`, detalle: d.nombre_original }
    case 'MOVER_A_PAPELERA':
      return { titulo: `${autor} ${conj('moviste', 'movió')} a papelera`, detalle: d.nombre_original }
    case 'RESTAURAR':
      return { titulo: `${autor} ${conj('restauraste', 'restauró')} un archivo`, detalle: d.nombre_original }
    case 'ELIMINAR_PERMANENTE':
      return { titulo: `${autor} eliminó definitivamente`, detalle: d.nombre_original }
    case 'CREAR_CARPETA':
      return { titulo: `${autor} ${conj('creaste', 'creó')} una carpeta`, detalle: d.nombre }
    case 'ELIMINAR_CARPETA':
      return { titulo: `${autor} eliminó una carpeta` }
    case 'MOVER':
      return { titulo: `${autor} ${conj('moviste', 'movió')} ${d.archivo_id ? 'un archivo' : 'una carpeta'}` }
    case 'COMPARTIR_ENLACE':
      return { titulo: `${autor} ${conj('compartiste', 'compartió')} por enlace` }
    case 'COMPARTIR_USUARIO':
      return { titulo: `${autor} ${conj('cediste', 'cedió')} a un miembro` }
    case 'COMPARTIR_EXTERNO':
      return { titulo: `${autor} ${conj('enviaste', 'envió')} fuera`, detalle: d.nombre_original }
    case 'ACCESO_WEBDAV':
      return { titulo: `${autor} ${conj('abriste', 'abrió')} desde el Explorador`, detalle: d.nombre_original }
    case 'ACTUALIZAR_WEBDAV':
      return { titulo: `${autor} ${conj('guardaste', 'guardó')} desde el Explorador`, detalle: d.nombre_original }
    case 'COPIAR_WEBDAV':
      return { titulo: `${autor} ${conj('copiaste', 'copió')} desde el Explorador`, detalle: d.nombre_original }
    case 'CREAR_ACCESO':
      return { titulo: `${autor} ${conj('creaste', 'creó')} un enlace` }
    case 'ELIMINAR_ACCESO':
      return { titulo: `${autor} eliminó un enlace` }
    case 'RENOMBRAR_ARCHIVO':
      return { titulo: `${autor} ${conj('renombraste', 'renombró')} un archivo`, detalle: d.nuevo }
    case 'RENOMBRAR_CARPETA':
      return { titulo: `${autor} ${conj('renombraste', 'renombró')} una carpeta`, detalle: d.nuevo }
    case 'CAMBIAR_PRIVACIDAD':
      return { titulo: `${autor} cambió la privacidad` }
    default:
      return { titulo: `${autor}: ${accion.toLowerCase().replace(/_/g, ' ')}` }
  }
}

// Portada: saludo, indicadores, accesos, actividad (según rol) y recordatorios.
export default async function InicioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase.from('perfiles').select('rol, nombre_completo').eq('id', user.id).single()
  const isAdmin = perfil?.rol === 'admin'
  const nombre = perfil?.nombre_completo?.split(' ')[0] ?? 'familia'
  // eslint-disable-next-line react-hooks/purity -- server component: se evalúa una vez por petición, sin re-renders
  const hace7d = new Date(Date.now() - 7 * DIA_MS).toISOString()

  const [
    usoRes, miosRes, nuevosRes, conmigoRes, miosCedidosRes,
    recRes, actRes, comunesRes, privadasRes,
  ] = await Promise.all([
    supabase.rpc('get_storage_usage'),
    supabase.from('archivos').select('id', { count: 'exact', head: true }).eq('subido_por', user.id).eq('estado', 'activo'),
    supabase.from('archivos').select('id', { count: 'exact', head: true }).eq('subido_por', user.id).eq('estado', 'activo').gte('fecha_subida', hace7d),
    supabase.from('compartidos').select('id', { count: 'exact', head: true }).eq('compartido_con', user.id),
    supabase.from('compartidos').select('id', { count: 'exact', head: true }).eq('creado_por', user.id),
    listarRecordatorios(),
    listarActividadReciente(8),
    supabase
      .from('carpetas')
      .select('id, nombre, color, fecha_creacion')
      .eq('es_privada', false)
      .is('carpeta_padre_id', null)
      .order('fecha_creacion', { ascending: false })
      .limit(4),
    supabase
      .from('carpetas')
      .select('id, nombre, color, fecha_creacion')
      .eq('es_privada', true)
      .eq('creado_por', user.id)
      .is('carpeta_padre_id', null)
      .order('fecha_creacion', { ascending: false })
      .limit(4),
  ])

  const usoBytes = typeof usoRes.data === 'number' ? usoRes.data : 0
  const recordatorios = recRes.data ?? []
  const pendientes = recordatorios.filter((r) => !r.completado)
  const vencidos = pendientes.filter((r) => r.vence_el < new Date().toISOString().slice(0, 10)).length
  const actividad = (actRes.data ?? [])
    .map((a) => ({ a, d: describir(a, user.id) }))
    .filter((x): x is { a: HistorialConPerfil; d: { titulo: string; detalle?: string } } => x.d !== null)
    .slice(0, 6)

  const raices = [
    ...((comunesRes.data ?? []).map((c) => ({ ...c, base: '/' as const }))),
    ...((privadasRes.data ?? []).map((c) => ({ ...c, base: '/mi-caja-fuerte' as const }))),
  ].sort((a, b) => +new Date(b.fecha_creacion) - +new Date(a.fecha_creacion)).slice(0, 4)

  const conteosCarpetas = await Promise.all(
    raices.map((c) =>
      supabase.from('archivos').select('id', { count: 'exact', head: true }).eq('carpeta_id', c.id).eq('estado', 'activo')
    )
  )

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <p className="eyebrow">Espacio familiar / Inicio</p>
        <h1 className="page-title">{saludo()}, {nombre}</h1>
        <p className="page-subtitle" style={vencidos > 0 ? { color: 'var(--color-danger)' } : undefined}>
          {vencidos > 0
            ? `Tienes ${vencidos} recordatorio${vencidos !== 1 ? 's' : ''} vencido${vencidos !== 1 ? 's' : ''}.`
            : 'Todo está en orden. Aquí tienes lo más importante de tu archivo familiar.'}
        </p>
      </div>

      <div className="grid-stats">
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
            <Files size={16} /> Mis archivos
          </p>
          <p style={{ fontSize: '1.6rem', fontWeight: 700 }}>{miosRes.count ?? 0}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>+{nuevosRes.count ?? 0} esta semana</p>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
            <Users size={16} /> Compartidos
          </p>
          <p style={{ fontSize: '1.6rem', fontWeight: 700 }}>{conmigoRes.count ?? 0}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>contigo · {miosCedidosRes.count ?? 0} cedes tú</p>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
            <Clock size={16} /> Recordatorios
          </p>
          <p style={{ fontSize: '1.6rem', fontWeight: 700 }}>{pendientes.length}</p>
          <p style={{ fontSize: '0.75rem', color: vencidos > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
            {vencidos > 0 ? `${vencidos} vencidos` : 'ninguno vencido'}
          </p>
        </div>
        <div className="card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
              <HardDrive size={16} /> Almacenamiento
            </p>
            <p style={{ fontSize: '1.6rem', fontWeight: 700 }}>{formatoCorto(usoBytes)}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>de 9 GB utilizados</p>
          </div>
          <AnilloProgreso pct={(usoBytes / LIMITE_BYTES) * 100} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '12px' }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>Accesos rápidos</h2>
        <Link href="/todos" className="breadcrumb-link" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
          Ver todos
        </Link>
      </div>
      <div className="grid-folders" style={{ marginBottom: '24px' }}>
        {raices.map((c, i) => (
          <Link key={c.id} href={`${c.base}?carpeta=${c.id}`} className="card card-hover" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', textDecoration: 'none' }}>
            <span className={`folder-card-icon fc-${c.color ?? 'indigo'}`} style={{ padding: '10px', marginBottom: 0 }}>
              <Folder size={20} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombre}</span>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{conteosCarpetas[i]?.count ?? 0} archivos</span>
            </span>
            <ArrowRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          </Link>
        ))}
      </div>

      <div className="dos-columnas">
        <section className="card" style={{ padding: '20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '4px' }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>{isAdmin ? 'Actividad reciente' : 'Tu actividad'}</h2>
            {isAdmin && (
              <Link href="/admin/historial" className="breadcrumb-link" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
                Ver todo
              </Link>
            )}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            {isAdmin ? 'Últimos cambios en el espacio familiar' : 'Tus últimos movimientos (lo ajeno es privado)'}
          </p>
          {actividad.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Aún no hay movimientos.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column' }}>
              {actividad.map(({ a, d }) => (
                <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
                  <span className="avatar avatar-sm" style={{ flexShrink: 0 }}>
                    {(a.usuario_id === user.id ? nombre : (a.perfiles?.nombre_completo ?? '?')).charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}>{d.titulo}</span>
                    {d.detalle && (
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.detalle}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                    {haceCuanto(a.fecha_evento)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" style={{ padding: '20px', minWidth: 0 }}>
          <RecordatoriosPortada iniciales={recordatorios} />
        </section>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', marginTop: '16px', background: 'linear-gradient(135deg, rgba(79,142,247,0.08), transparent)' }}>
        <ShieldCheck size={22} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <p style={{ fontSize: '0.85rem' }}>
          <strong>Tu archivo familiar está protegido.</strong>{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>
            Tu caja fuerte solo la ves tú{isAdmin ? ' (y tú ves todo como admin)' : ' y el administrador'}. Nada se borra solo: los avisos no tocan archivos.
          </span>
        </p>
      </div>
    </div>
  )
}
