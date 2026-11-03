import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { putToR2, buildStagingKey, deleteFromR2 } from '@/lib/r2/client'
import { normalizarTipoMime, sanitizarNombreArchivo } from '@/lib/archivos-seguros'
import type { FicheroEnLote } from '@/types/database'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, igual que la subida normal
const MAX_FILES = 10 // tope de ficheros por lote compartido
const MAX_CUERPO = MAX_FILES * MAX_FILE_SIZE + 2 * 1024 * 1024 // margen multipart

// La redirección tras el POST debe volver al mismo origen que lo envió
// (la PWA instalada en el móvil). Se usa NEXT_PUBLIC_APP_URL cuando existe para
// no depender del header Host (que un cliente podría falsificar).
function urlDestino(request: Request, destino: string): string {
  const ruta = destino.startsWith('/') && !destino.startsWith('//') ? destino : '/'
  const configurada = process.env.NEXT_PUBLIC_APP_URL
  if (configurada) {
    try {
      return new URL(ruta, configurada).toString()
    } catch {
      // URL mal configurada: se cae al origen de la petición.
    }
  }
  return new URL(ruta, request.url).toString()
}

type FicheroRecibido = { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }

// Detección por forma en vez de `instanceof File` (frágil entre reinos del runtime).
// Se declara `v is File` para que TypeScript estreche FormDataEntryValue.
// Se acepta size 0: un fichero vacío es legítimo; lo que se descarta es la
// entrada placeholder sin nombre que algunos navegadores envían.
function esFichero(v: FormDataEntryValue): v is File {
  if (typeof v !== 'object' || v === null) return false
  const f = v as unknown as Record<string, unknown> & Partial<FicheroRecibido>
  return (
    typeof f.arrayBuffer === 'function' &&
    typeof f.size === 'number' && (f.size as number) >= 0 &&
    typeof f.name === 'string' && (f.name as string).length > 0
  )
}

// Destino del Web Share Target (manifest.json → action /api/recibir).
// El POST con los ficheros no sobrevive a un redirect del middleware, por eso
// la ruta es pública y la sesión se valida aquí dentro.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response(
      '<!doctype html><html lang="es"><body style="font-family:sans-serif;padding:24px">' +
      '<h1>Sesión requerida</h1>' +
      '<p>Inicia sesión en Gestor Familiar e inténtalo de nuevo para guardar lo compartido.</p>' +
      '<a href="/login">Ir al login</a>' +
      '</body></html>',
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // Corte temprano si el cliente declara un cuerpo desmedido. Si no hay
  // Content-Length se sigue adelante (algunos Web Share Target usan chunked);
  // el límite por fichero se vuelve a comprobar después.
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_CUERPO) {
    return NextResponse.redirect(urlDestino(request, '/recibir?error=demasiados'), 303)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.redirect(urlDestino(request, '/recibir?error=formulario'), 303)
  }

  // `instanceof File` falla entre reinos del runtime del servidor, así que se
  // detecta por forma. Se rastrean TODAS las entradas: algunos móviles
  // empaquetan con otra clave distinta de 'archivos', o envían un placeholder
  // vacío bajo 'archivos' junto a los ficheros reales.
  const ficheros = [...formData.values()].filter(esFichero)

  if (ficheros.length === 0) {
    // ¿Llegó texto/enlace en vez de archivo? Se informa distinto que el vacío total.
    // Solo cuentan valores no vacíos: algunos navegadores envían los campos vacíos.
    const hayTexto = ['title', 'text', 'url'].some((k) => {
      const v = formData.get(k)
      return typeof v === 'string' && v.trim() !== ''
    })
    if (hayTexto) {
      return NextResponse.redirect(urlDestino(request, '/recibir?error=texto'), 303)
    }
    return NextResponse.redirect(urlDestino(request, '/recibir?error=vacio'), 303)
  }
  if (ficheros.length > MAX_FILES) {
    return NextResponse.redirect(urlDestino(request, '/recibir?error=demasiados'), 303)
  }

  const claves: string[] = []
  const metadatos: FicheroEnLote[] = []

  try {
    for (const fichero of ficheros) {
      if (fichero.size > MAX_FILE_SIZE) {
        throw new Error('Archivo demasiado grande.')
      }
      const nombre = sanitizarNombreArchivo(fichero.name)
      const tipo = normalizarTipoMime(fichero.type)
      const bytes = new Uint8Array(await fichero.arrayBuffer())
      if (bytes.byteLength > MAX_FILE_SIZE) {
        throw new Error('Archivo demasiado grande.')
      }
      const clave = buildStagingKey({ userId: user.id, fileName: nombre })
      await putToR2(clave, bytes, tipo)
      claves.push(clave)
      metadatos.push({ clave, nombre, tipo, tamano: bytes.byteLength })
    }
  } catch {
    // Limpia lo ya subido a staging para no dejar basura huérfana en R2
    await Promise.all(claves.map((c) => deleteFromR2(c).catch(() => {})))
    return NextResponse.redirect(urlDestino(request, '/recibir?error=subida'), 303)
  }

  const { data: lote, error } = await supabase
    .from('lotes_recibidos')
    .insert({ usuario_id: user.id, claves_r2: claves, metadatos })
    .select('id')
    .single()

  if (error || !lote) {
    await Promise.all(claves.map((c) => deleteFromR2(c).catch(() => {})))
    return NextResponse.redirect(urlDestino(request, '/recibir?error=basedatos'), 303)
  }

  return NextResponse.redirect(urlDestino(request, `/recibir?lote=${lote.id}`), 303)
}
