import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { putToR2, buildR2Key, deleteFromR2 } from '@/lib/r2/client'
import type { Database } from '@/types/database'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, igual que la subida normal

// Subida directa para automatizaciones (Atajo de iOS, scripts): la PWA no puede
// recibir shares en iPhone, así que el Atajo envía el archivo aquí con un token
// de Explorador (los mismos de /ajustes). Ver docs/guias/atajo-ios.md.
// Auth: `Authorization: Bearer <token>`. Sin sesión de navegador (ruta pública
// en middleware.ts); la autorización se valida por token + reglas manuales.
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Subida por API no configurada en el servidor.' }, { status: 500 })
  }

  const cab = request.headers.get('authorization') ?? ''
  const token = cab.toLowerCase().startsWith('bearer ') ? cab.slice(7).trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'Falta el token (Authorization: Bearer ...).' }, { status: 401 })
  }

  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } })
  const hash = createHash('sha256').update(token).digest('hex')

  const { data: filasToken } = await supabase
    .from('tokens_dav')
    .select('usuario_id')
    .eq('token_hash', hash)
    .eq('revocado', false)
    .limit(1)
  const usuarioId = filasToken?.[0]?.usuario_id
  if (!usuarioId) {
    return NextResponse.json({ error: 'Token no válido o revocado.' }, { status: 401 })
  }
  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', usuarioId).single()
  const isAdmin = perfil?.rol === 'admin'

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Formulario ilegible (multipart/form-data).' }, { status: 400 })
  }

  const entrada = formData.get('archivo')
  const esFichero =
    typeof entrada === 'object' && entrada !== null &&
    typeof (entrada as File).arrayBuffer === 'function' &&
    typeof (entrada as File).name === 'string' && (entrada as File).name.length > 0
  if (!esFichero) {
    return NextResponse.json({ error: 'Falta el campo "archivo" con el fichero.' }, { status: 400 })
  }
  const fichero = entrada as File
  if (fichero.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `"${fichero.name}" supera el límite de 20 MB.` }, { status: 413 })
  }

  const scope = formData.get('scope') === 'privado' ? 'privado' : 'comun'
  const carpetaId = typeof formData.get('carpetaId') === 'string' && (formData.get('carpetaId') as string).trim() !== ''
    ? ((formData.get('carpetaId') as string).trim())
    : null

  if (carpetaId) {
    const { data: carpeta } = await supabase
      .from('carpetas')
      .select('id, es_privada, creado_por')
      .eq('id', carpetaId)
      .single()
    // Visible = pública, propia o admin (réplica de RLS carpetas_select)
    const visible = carpeta && (!carpeta.es_privada || carpeta.creado_por === usuarioId || isAdmin)
    if (!visible) {
      return NextResponse.json({ error: 'Carpeta de destino no válida.' }, { status: 400 })
    }
    if ((scope === 'privado') !== carpeta.es_privada) {
      return NextResponse.json({ error: 'El destino no concuerda con el ámbito (scope).' }, { status: 400 })
    }
  }

  const tipo = fichero.type || 'application/octet-stream'
  const key = buildR2Key({ userId: usuarioId, fileName: fichero.name, scope })

  try {
    await putToR2(key, new Uint8Array(await fichero.arrayBuffer()), tipo)
  } catch {
    return NextResponse.json({ error: 'No se pudo guardar en el almacenamiento.' }, { status: 502 })
  }

  const { data: insertado, error: insertError } = await supabase
    .from('archivos')
    .insert({
      nombre_original: fichero.name,
      ruta_r2: key,
      tamano_bytes: fichero.size,
      tipo_mime: tipo,
      carpeta_id: carpetaId,
      subido_por: usuarioId,
      estado: 'activo',
    })
    .select('id')
    .single()

  if (insertError || !insertado) {
    await deleteFromR2(key).catch(() => {})
    if ((insertError?.message ?? '').includes('LIMITE_ALMACENAMIENTO')) {
      return NextResponse.json({ error: 'Almacenamiento familiar lleno (9 GB).' }, { status: 507 })
    }
    return NextResponse.json({ error: insertError?.message ?? 'No se pudo registrar el archivo.' }, { status: 500 })
  }

  // Best-effort: último uso del token (no bloquea la respuesta)
  const { data: tok } = await supabase.from('tokens_dav').select('id').eq('token_hash', hash).limit(1).single()
  if (tok) {
    await supabase.from('tokens_dav').update({ ultimo_uso: new Date().toISOString() }).eq('id', (tok as { id: string }).id)
  }

  return NextResponse.json({ ok: true, id: insertado.id, nombre: fichero.name })
}
