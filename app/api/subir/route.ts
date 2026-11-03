import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { putToR2, buildR2Key, deleteFromR2 } from '@/lib/r2/client'
import { esUuidValido, normalizarTipoMime, sanitizarNombreArchivo } from '@/lib/archivos-seguros'
import type { Database } from '@/types/database'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, igual que la subida normal
// Margen para las cabeceras y el boundary del multipart.
const MAX_CUERPO = MAX_FILE_SIZE + 1024 * 1024

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

  // Se rechaza antes de leer el cuerpo: evita que un cliente autenticado envíe
  // cientos de MB a memoria. Los clientes reales siempre mandan Content-Length.
  const contentLength = Number(request.headers.get('content-length'))
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return NextResponse.json({ error: 'Falta Content-Length.' }, { status: 411 })
  }
  if (contentLength > MAX_CUERPO) {
    return NextResponse.json({ error: 'El archivo supera el límite de 20 MB.' }, { status: 413 })
  }

  const tipoContenido = request.headers.get('content-type') ?? ''
  if (!tipoContenido.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Se esperaba multipart/form-data.' }, { status: 415 })
  }

  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } })
  const hash = createHash('sha256').update(token).digest('hex')

  const { data: filasToken } = await supabase
    .from('tokens_dav')
    .select('id, usuario_id')
    .eq('token_hash', hash)
    .eq('revocado', false)
    .limit(1)
  const filaToken = filasToken?.[0]
  const usuarioId = filaToken?.usuario_id
  if (!usuarioId) {
    return NextResponse.json({ error: 'Token no válido o revocado.' }, { status: 401 })
  }

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

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await fichero.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 400 })
  }
  const tamano = bytes.byteLength
  if (tamano > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'El archivo supera el límite de 20 MB.' }, { status: 413 })
  }

  const scope = formData.get('scope') === 'privado' ? 'privado' : 'comun'
  const carpetaBruta = formData.get('carpetaId')
  const carpetaId = typeof carpetaBruta === 'string' && carpetaBruta.trim() !== ''
    ? carpetaBruta.trim()
    : null

  if (carpetaId) {
    if (!esUuidValido(carpetaId)) {
      return NextResponse.json({ error: 'Carpeta de destino no válida.' }, { status: 400 })
    }
    const { data: carpeta } = await supabase
      .from('carpetas')
      .select('id, es_privada, creado_por')
      .eq('id', carpetaId)
      .single()
    // Visible = pública o propia. El admin NO puede escribir en la caja fuerte
    // de otro miembro: es privada incluso para él.
    const visible = carpeta && (!carpeta.es_privada || carpeta.creado_por === usuarioId)
    if (!visible) {
      return NextResponse.json({ error: 'Carpeta de destino no válida.' }, { status: 400 })
    }
    if ((scope === 'privado') !== carpeta.es_privada) {
      return NextResponse.json({ error: 'El destino no concuerda con el ámbito (scope).' }, { status: 400 })
    }
  }

  const nombre = sanitizarNombreArchivo(fichero.name)
  const tipo = normalizarTipoMime(fichero.type)
  const key = buildR2Key({ userId: usuarioId, fileName: nombre, scope })

  try {
    await putToR2(key, bytes, tipo)
  } catch {
    return NextResponse.json({ error: 'No se pudo guardar en el almacenamiento.' }, { status: 502 })
  }

  const { data: insertado, error: insertError } = await supabase
    .from('archivos')
    .insert({
      nombre_original: nombre,
      ruta_r2: key,
      tamano_bytes: tamano,
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
    console.error('[api/subir] insert falló:', insertError?.message ?? 'sin fila')
    return NextResponse.json({ error: 'No se pudo registrar el archivo.' }, { status: 500 })
  }

  // Best-effort: último uso del token (no bloquea la respuesta)
  if (filaToken?.id) {
    await supabase
      .from('tokens_dav')
      .update({ ultimo_uso: new Date().toISOString() })
      .eq('id', filaToken.id)
  }

  return NextResponse.json({ ok: true, id: insertado.id, nombre })
}
