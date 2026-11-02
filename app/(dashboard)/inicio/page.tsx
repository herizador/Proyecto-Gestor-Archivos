import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Files, Users, Clock, HardDrive, Folder, ArrowRight, ShieldCheck,
  FolderOpen, LockKeyhole, Sparkles,
} from 'lucide-react'
import RecordatoriosPortada from '@/components/RecordatoriosPortada'
import AnilloProgreso from '@/components/AnilloProgreso'
import Canvas3D from '@/components/inicio/Canvas3D'
import UploadModalWrapper from '../UploadModalWrapper'
import { NAV_SECUNDARIA } from '@/components/navegacion'
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
    case 'BLOQUEAR_WEBDAV':
      return {
        titulo: `${autor} ${conj('bloqueaste', 'bloqueó')} ${d.tipo === 'carpeta' ? 'una carpeta' : 'un archivo'} desde el Explorador`,
        detalle: d.nombre,
      }
    case 'DESBLOQUEAR_WEBDAV':
      return {
        titulo: `${autor} ${conj('liberaste', 'liberó')} ${d.tipo === 'carpeta' ? 'una carpeta' : 'un archivo'} desde el Explorador`,
        detalle: d.nombre,
      }
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

// Portada: saludo, hero 3D, indicadores, accesos, actividad (según rol) y recordatorios.
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
      <section className="hero-inicio" aria-labelledby="hero-titulo">
        <div className="hero-texto">
          <p className="eyebrow hero-eyebrow">
            <Sparkles size={13} /> Tu archivo familiar
          </p>
          <h1 className="hero-titulo" id="hero-titulo">
            {saludo()}, <span>{nombre}</span>
          </h1>
          <p className="hero-subtitulo">
            Los documentos importantes de la familia, en un solo lugar tranquilo.
            Busca, guarda y comparte sin perderte por menús.
          </p>

          <div className="hero-acciones">
            <Link href="/todos" className="btn btn-primary btn-lg">
              <FolderOpen size={18} /> Ver mis archivos
            </Link>
            <UploadModalWrapper
              scope="comun"
              className="btn btn-ghost btn-lg"
              label="Subir un archivo"
              iconSize={18}
            />
            <Link href="/mi-caja-fuerte" className="btn btn-ghost btn-lg">
              <LockKeyhole size={18} /> Caja fuerte
            </Link>
          </div>

          <div className="hero-mini">
            <span><ShieldCheck size={15} /> Privado por defecto</span>
            <span><Users size={15} /> Comparte solo lo que quieras</span>
            <span><HardDrive size={15} /> {formatoCorto(usoBytes)} de 9 GB</span>
            {vencidos > 0 && (
              <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                <Clock size={15} /> {vencidos} recordatorio{vencidos !== 1 ? 's' : ''} vencido{vencidos !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <Canvas3D />
      </section>

      <div className="grid-stats" style={{ marginTop: '20px' }}>
        <div className="card stat-card">
          <span className="stat-icono"><Files size={19} /></span>
          <span className="stat-etiqueta">Mis archivos</span>
          <span className="stat-valor">{miosRes.count ?? 0}</span>
          <span className="stat-pista">+{nuevosRes.count ?? 0} esta semana</span>
        </div>

        <div className="card stat-card">
          <span className="stat-icono verde"><Users size={19} /></span>
          <span className="stat-etiqueta">Compartidos contigo</span>
          <span className="stat-valor">{conmigoRes.count ?? 0}</span>
          <span className="stat-pista">{miosCedidosRes.count ?? 0} compartes tú</span>
        </div>

        <div className="card stat-card">
          <span className="stat-icono ambar"><Clock size={19} /></span>
          <span className="stat-etiqueta">Recordatorios</span>
          <span className="stat-valor">{pendientes.length}</span>
          <span className="stat-pista" style={vencidos > 0 ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined}>
            {vencidos > 0 ? `${vencidos} vencido${vencidos !== 1 ? 's' : ''}` : 'Ninguno vencido'}
          </span>
        </div>

        <div className="card stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span className="stat-icono violeta" style={{ marginBottom: '8px' }}><HardDrive size={19} /></span>
              <span className="stat-etiqueta">Almacenamiento</span>
              <span className="stat-valor">{formatoCorto(usoBytes)}</span>
              <span className="stat-pista">de 9 GB utilizados</span>
            </div>
            <AnilloProgreso pct={(usoBytes / LIMITE_BYTES) * 100} />
          </div>
        </div>
      </div>

      <div className="seccion-cabecera">
        <h2 className="section-title">Tus carpetas</h2>
        <Link href="/todos" className="enlace-ver">
          Ver todas <ArrowRight size={14} />
        </Link>
      </div>

      {raices.length === 0 ? (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 20px' }}>
          <span className="stat-icono" style={{ marginBottom: 0 }}><Folder size={19} /></span>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
            Todavía no hay carpetas. Crea la primera desde <Link href="/todos" className="breadcrumb-link">Mis archivos</Link>.
          </p>
        </div>
      ) : (
        <div
          className="grid-folders"
          style={{ marginBottom: '6px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
        >
          {raices.map((c, i) => (
            <Link key={c.id} href={`${c.base}?carpeta=${c.id}`} className="card card-hover acceso-carpeta">
              <span className={`folder-card-icon fc-${c.color ?? 'indigo'}`} style={{ padding: '10px', marginBottom: 0 }}>
                <Folder size={20} />
              </span>
              <span className="acceso-carpeta-texto">
                <span className="acceso-carpeta-nombre">{c.nombre}</span>
                <span className="acceso-carpeta-meta">
                  {conteosCarpetas[i]?.count ?? 0} archivo{(conteosCarpetas[i]?.count ?? 0) !== 1 ? 's' : ''}
                  {' · '}
                  {c.base === '/' ? 'Familiar' : 'Caja fuerte'}
                </span>
              </span>
              <ArrowRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}

      <div className="seccion-cabecera">
        <h2 className="section-title">También te puede interesar</h2>
      </div>
      <div className="accesos-secundarios">
        {NAV_SECUNDARIA.map((item) => (
          <Link key={item.href} href={item.href} className="mini-acceso">
            <span className="mini-acceso-icono">{item.icono}</span>
            <span className="mini-acceso-texto">
              <span className="mini-acceso-titulo">{item.texto}</span>
              <span className="mini-acceso-desc">{item.descripcion}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="dos-columnas" style={{ marginTop: '28px' }}>
        <section className="card" style={{ padding: '22px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '4px' }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              {isAdmin ? 'Actividad reciente' : 'Tu actividad'}
            </h2>
            {isAdmin && (
              <Link href="/admin/historial" className="enlace-ver">
                Ver todo <ArrowRight size={14} />
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

        <section className="card" style={{ padding: '22px', minWidth: 0 }}>
          <RecordatoriosPortada iniciales={recordatorios} />
        </section>
      </div>

      <div className="nota-privacidad">
        <span className="nota-privacidad-icono"><ShieldCheck size={18} /></span>
        <p>
          <strong>Tu espacio privado, de verdad.</strong>{' '}
          La caja fuerte solo la ves tú. Compartir es siempre una decisión tuya y nada se borra solo:
          los recordatorios no tocan archivos.
        </p>
      </div>
    </div>
  )
}
