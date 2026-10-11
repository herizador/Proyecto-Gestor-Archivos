import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { limpiarLotesCaducados } from '@/actions/recibir'
import SelectorDestino from '@/components/SelectorDestino'
import GuardadoManual from '@/components/GuardadoManual'
import Link from 'next/link'
import type { Carpeta, FicheroEnLote, Json } from '@/types/database'
import { Inbox, AlertTriangle, CheckCircle2, Smartphone } from 'lucide-react'

const MENSAJES_ERROR: Record<string, string> = {
  formulario: 'No se pudo leer lo compartido. Inténtalo de nuevo.',
  vacio: 'No llegó ningún archivo para guardar.',
  texto: 'Se compartió texto o un enlace, no un archivo. Solo se pueden guardar archivos.',
  demasiados: 'Demasiados archivos a la vez (máximo 10).',
  basedatos: 'Se subieron los archivos pero no se pudo registrar el lote.',
}

function parsearFicheros(metadatos: Json): FicheroEnLote[] {
  if (!Array.isArray(metadatos)) return []
  return metadatos.filter(
    (m): m is FicheroEnLote =>
      typeof m === 'object' && m !== null &&
      typeof (m as FicheroEnLote).clave === 'string' &&
      typeof (m as FicheroEnLote).nombre === 'string'
  )
}

export default async function RecibirPage({
  searchParams,
}: {
  searchParams: Promise<{ lote?: string; error?: string; ok?: string; guardados?: string; total?: string; scope?: string; carpeta?: string }>
}) {
  const { lote: loteId, error, ok, guardados, total, scope, carpeta: carpetaDestinoId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Sesión requerida</h1>
          <p className="login-subtitle">
            Inicia sesión para guardar lo compartido. Ten en cuenta que lo compartido
            desde otra app se pierde al cambiar de pantalla: vuelve a compartirlo tras entrar.
          </p>
          <a className="btn btn-primary" href="/login" style={{ marginTop: '16px', textDecoration: 'none' }}>
            Ir al login
          </a>
        </div>
      </div>
    )
  }

  // Limpieza oportunista de lotes caducados (barata cuando no hay nada)
  await limpiarLotesCaducados()

  // Pantalla de éxito: no depende del lote (ya borrado), sobrevive a refrescos
  if (ok === '1') {
    const n = Number(guardados ?? '0')
    const t = Number(total ?? '0')
    let destinoHref = scope === 'privado' ? '/mi-caja-fuerte' : '/'
    let destinoNombre = scope === 'privado' ? 'Mi caja fuerte' : 'Área común'
    if (carpetaDestinoId) {
      const { data: carpeta } = await supabase
        .from('carpetas')
        .select('id, nombre')
        .eq('id', carpetaDestinoId)
        .single()
      if (carpeta) {
        destinoNombre = carpeta.nombre
        destinoHref += `?carpeta=${carpeta.id}`
      }
    }
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <CheckCircle2 size={48} style={{ color: 'var(--color-success, #4ade80)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Guardado en {destinoNombre}</h1>
          <p className="login-subtitle">
            {n === t ? `${n} archivo(s) guardados.` : `${n} de ${t} guardados (algunos fallaron).`}
          </p>
          <a className="btn btn-primary" href={destinoHref} style={{ marginTop: '16px', textDecoration: 'none' }}>
            Ver archivos guardados
          </a>
        </div>
      </div>
    )
  }

  if (error || !loteId) {
    const esVacio = error === 'vacio'
    // En iPhone el sistema nunca entrega archivos a una web (Apple no soporta
    // Web Share Target): se detecta por UA en servidor y se explican los pasos.
    const ua = (await headers()).get('user-agent') ?? ''
    const esIOS = /iPhone|iPad|iPod/.test(ua)
    // Raíces para el plan B manual: en iOS no existe Web Share Target y en
    // algunos Android el sistema no entrega el fichero. El usuario puede
    // elegirlo con el selector nativo sin salir de esta pantalla.
    const [{ data: raicesComun }, { data: raicesPrivadas }, { data: perfil }] = await Promise.all([
      supabase.from('carpetas').select('*').eq('es_privada', false).is('carpeta_padre_id', null).order('fecha_creacion'),
      supabase.from('carpetas').select('*').eq('es_privada', true).eq('creado_por', user.id).is('carpeta_padre_id', null).order('fecha_creacion'),
      supabase.from('perfiles').select('rol').eq('id', user.id).single(),
    ])
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <Inbox size={48} style={{ color: 'var(--color-text-muted)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Nada que guardar</h1>
          <p className="login-subtitle">
            {error ? (MENSAJES_ERROR[error] ?? decodeURIComponent(error)) : 'Comparte un archivo desde otra app para verlo aquí.'}
          </p>
          {esVacio && !esIOS && (
            <p className="login-subtitle" style={{ marginTop: '8px' }}>
              El sistema no entregó ningún archivo (algunos Android lo bloquean).
              Elígelo abajo manualmente:
            </p>
          )}
          {esIOS && (
            <div style={{ textAlign: 'left', marginTop: '12px', padding: '12px 16px', background: 'var(--color-accent-dim)', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>
                <Smartphone size={18} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                En iPhone se hace en 2 pasos
              </p>
              <ol style={{ fontSize: '0.85rem', color: 'var(--color-text-subtle)', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>En la otra app pulsa Compartir → <strong>Guardar en Archivos</strong> (las fotos también valen desde Fototeca).</li>
                <li>Elígelo abajo con el botón: puedes cogerlo de Fototeca, Archivos o hacer una foto.</li>
              </ol>
            </div>
          )}
          <div style={{ textAlign: 'left' }}>
            <GuardadoManual
              raicesComun={(raicesComun ?? []) as Carpeta[]}
              raicesPrivadas={(raicesPrivadas ?? []) as Carpeta[]}
              userId={user.id}
              isAdmin={perfil?.rol === 'admin'}
            />
          </div>
          <Link className="btn btn-ghost" href="/" style={{ marginTop: '16px', textDecoration: 'none' }}>
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  const { data: lote } = await supabase
    .from('lotes_recibidos')
    .select('*')
    .eq('id', loteId)
    .eq('usuario_id', user.id)
    .single()

  if (!lote) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-danger)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Lote no válido</h1>
          <p className="login-subtitle">Puede que ya se haya guardado o que haya caducado.</p>
        </div>
      </div>
    )
  }

  const ficheros = parsearFicheros(lote.metadatos)

  const [{ data: raicesComun }, { data: raicesPrivadas }, { data: perfil }] = await Promise.all([
    supabase.from('carpetas').select('*').eq('es_privada', false).is('carpeta_padre_id', null).order('fecha_creacion'),
    supabase.from('carpetas').select('*').eq('es_privada', true).eq('creado_por', user.id).is('carpeta_padre_id', null).order('fecha_creacion'),
    supabase.from('perfiles').select('rol').eq('id', user.id).single(),
  ])

  return (
    <div className="login-bg">
      <div style={{ width: '100%', maxWidth: '560px' }}>
        <div className="login-card" style={{ maxWidth: 'none' }}>
          <h1 className="login-title" style={{ fontSize: '1.2rem', marginBottom: '4px' }}>Guardar lo compartido</h1>
          <p className="login-subtitle" style={{ marginBottom: '20px' }}>Elige dónde guardarlo</p>
          <SelectorDestino
            loteId={lote.id}
            ficheros={ficheros}
            raicesComun={(raicesComun ?? []) as Carpeta[]}
            raicesPrivadas={(raicesPrivadas ?? []) as Carpeta[]}
            userId={user.id}
            isAdmin={perfil?.rol === 'admin'}
          />
        </div>
      </div>
    </div>
  )
}
