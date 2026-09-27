import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { putToR2, buildStagingKey, deleteFromR2 } from '@/lib/r2/client'
import type { FicheroEnLote } from '@/types/database'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, igual que la subida normal
const MAX_FILES = 10 // tope de ficheros por lote compartido
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type FicheroRecibido = { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }

// Detección por forma en vez de `instanceof File` (frágil entre reinos del runtime).
// Se declara `v is File` para que TypeScript estreche FormDataEntryValue.
function esFichero(v: FormDataEntryValue): v is File {
  if (typeof v !== 'object' || v === null) return false
  const f = v as unknown as Record<string, unknown> & Partial<FicheroRecibido>
  return (
    typeof f.arrayBuffer === 'function' &&
    typeof f.size === 'number' && (f.size as number) > 0 &&
    typeof f.name === 'string' && (f.name as string).length > 0
  )
}

// Destino del Web Share Target (manifest.json → action /api/recibir).
// El POST con los ficheros no sobrevive a un redirect del middleware, por eso
// la ruta es pública y la sesión se valida aquí dentro.
export async function POST(request: Request) {
  console.log('[recibir] POST', request.method, request.headers.get('content-type'))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response(
      '<!doctype html><html lang="es"><body style="font-family:sans-serif;padding:24px">' +
      '<h1>Sesión requerida</h1>' +
      '<p>Inicia sesión en Gestor Familiar e inténtalo de nuevo para guardar lo compartido.</p>' +
      `<a href="${BASE_URL}/login">Ir al login</a>` +
      '</body></html>',
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (e) {
    console.error('[recibir] formData ilegible:', e instanceof Error ? e.message : e)
    return NextResponse.redirect(`${BASE_URL}/recibir?error=formulario`, 303)
  }

  console.log('[recibir] claves del formulario:', [...formData.keys()])

  // `instanceof File` falla entre reinos del runtime del servidor, así que se
  // detecta por forma: objeto con arrayBuffer(), size numérico y name.
  // Primero la clave del manifest ('archivos'); si viene vacía, se rastrean
  // todas las entradas por si el sistema empaquetó con otra clave.
  const candidatos = formData.getAll('archivos').length > 0
    ? formData.getAll('archivos')
    : [...formData.values()]
  const ficheros = candidatos.filter(esFichero)

  console.log('[recibir] ficheros detectados:', ficheros.map((f) => ({ nombre: f.name, tipo: f.type, tamano: f.size })))

  if (ficheros.length === 0) {
    return NextResponse.redirect(`${BASE_URL}/recibir?error=vacio`, 303)
  }
  if (ficheros.length > MAX_FILES) {
    return NextResponse.redirect(`${BASE_URL}/recibir?error=demasiados`, 303)
  }

  const claves: string[] = []
  const metadatos: FicheroEnLote[] = []

  try {
    for (const fichero of ficheros) {
      if (fichero.size > MAX_FILE_SIZE) {
        throw new Error(`"${fichero.name}" supera el límite de 20 MB.`)
      }
      const tipo = fichero.type || 'application/octet-stream'
      const clave = buildStagingKey({ userId: user.id, fileName: fichero.name })
      await putToR2(clave, new Uint8Array(await fichero.arrayBuffer()), tipo)
      claves.push(clave)
      metadatos.push({ clave, nombre: fichero.name, tipo, tamano: fichero.size })
    }
  } catch (e) {
    // Limpia lo ya subido a staging para no dejar basura huérfana en R2
    await Promise.all(claves.map((c) => deleteFromR2(c).catch(() => {})))
    const motivo = e instanceof Error ? e.message : 'subida'
    return NextResponse.redirect(
      `${BASE_URL}/recibir?error=${encodeURIComponent(motivo)}`, 303
    )
  }

  const { data: lote, error } = await supabase
    .from('lotes_recibidos')
    .insert({ usuario_id: user.id, claves_r2: claves, metadatos })
    .select('id')
    .single()

  if (error || !lote) {
    await Promise.all(claves.map((c) => deleteFromR2(c).catch(() => {})))
    return NextResponse.redirect(`${BASE_URL}/recibir?error=basedatos`, 303)
  }

  return NextResponse.redirect(`${BASE_URL}/recibir?lote=${lote.id}`, 303)
}
