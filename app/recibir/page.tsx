import { createClient } from '@/lib/supabase/server'
import { limpiarLotesCaducados } from '@/actions/recibir'
import SelectorDestino from '@/components/SelectorDestino'
import type { Carpeta, FicheroEnLote, Json } from '@/types/database'
import { Inbox, AlertTriangle } from 'lucide-react'

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
  searchParams: Promise<{ lote?: string; error?: string }>
}) {
  const { lote: loteId, error } = await searchParams
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

  if (error || !loteId) {
    return (
      <div className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <Inbox size={48} style={{ color: 'var(--color-text-muted)', margin: '0 auto 16px' }} />
          <h1 className="login-title">Nada que guardar</h1>
          <p className="login-subtitle">
            {error ? (MENSAJES_ERROR[error] ?? decodeURIComponent(error)) : 'Comparte un archivo desde otra app para verlo aquí.'}
          </p>
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
