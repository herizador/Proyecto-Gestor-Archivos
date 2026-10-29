// Fase A de escritura WebDAV: PUT (nuevo y sobrescritura), MKCOL y DELETE.
// Replica las reglas de la PWA: propiedad, cupo de 9 GB, tope de 20 MB,
// papelera de archivos y auditoría. Diseño en docs/diseno/webdav-escritura.md.

import {
  LIMITE_BYTES,
  MAX_FILE_SIZE,
  type Env,
  type FilaArchivo,
  type FilaCarpeta,
  type UsuarioDav,
} from './env'
import { archivoHijo, carpetaHija, resolver, resolverPadre } from './arbol'
import { auditar, errorDeBd, sb, sbVoid, usoAlmacenamiento } from './supabase'
import {
  borrarKey,
  cabecerasPrivadas,
  etagDe,
  hrefDe,
  keyNueva,
  mimeEfectivo,
  nombreValido,
  responderError,
} from './util'

type CuerpoLeido =
  | { ok: true; body: ReadableStream<Uint8Array> | ArrayBuffer; tamano: number }
  | { ok: false; status: number; error: string }

// Lee el cuerpo sin pasar del tope. Con Content-Length se puede pasar el
// stream directo a R2; sin él (chunked) se bufferiza como máximo 20 MB.
export async function leerCuerpoLimitado(req: Request, maximo: number): Promise<CuerpoLeido> {
  const cab = req.headers.get('content-length')
  if (cab !== null && cab.trim() !== '') {
    const tamano = Number(cab)
    if (!Number.isFinite(tamano) || tamano < 0) {
      return { ok: false, status: 400, error: 'Content-Length no válido.' }
    }
    if (tamano > maximo) {
      return { ok: false, status: 413, error: 'El archivo supera el límite de 20 MB.' }
    }
    if (tamano === 0) return { ok: true, body: new ArrayBuffer(0), tamano: 0 }
    if (!req.body) return { ok: false, status: 400, error: 'Falta el cuerpo del archivo.' }
    return { ok: true, body: req.body, tamano }
  }

  if (!req.body) return { ok: true, body: new ArrayBuffer(0), tamano: 0 }

  const reader = req.body.getReader()
  const trozos: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maximo) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413, error: 'El archivo supera el límite de 20 MB.' }
      }
      trozos.push(value)
    }
  } catch {
    return { ok: false, status: 400, error: 'No se pudo leer el cuerpo del archivo.' }
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const trozo of trozos) {
    buffer.set(trozo, offset)
    offset += trozo.byteLength
  }
  return { ok: true, body: buffer.buffer, tamano: total }
}

function etiquetas(cabecera: string): string[] {
  return cabecera.split(',').map((t) => t.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// PUT: archivo nuevo (201) o sobrescritura (204).
// La sobrescritura sube a una key nueva y actualiza la fila antes de borrar la
// anterior: si la BD falla, los bytes viejos siguen intactos y en su sitio.
// ---------------------------------------------------------------------------
export async function responderPut(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const padre = await resolverPadre(env, user, segs)
  if (!padre.ok) return responderError(padre.status, padre.error)

  const nombre = segs[segs.length - 1]
  const motivo = nombreValido(nombre, false)
  if (motivo) return responderError(400, motivo)

  const [carpetaMisma, archivoActual] = await Promise.all([
    carpetaHija(env, user, padre.scope, padre.carpetaId, nombre),
    archivoHijo(env, user, padre.scope, padre.carpetaId, nombre),
  ])
  if (carpetaMisma) {
    return responderError(409, 'Ya existe una carpeta con ese nombre.')
  }
  if (archivoActual && archivoActual.subido_por !== user.id && user.rol !== 'admin') {
    return responderError(403, 'Solo el dueño o un administrador puede sobrescribir este archivo.')
  }

  const etagActual = archivoActual ? etagDe(archivoActual) : null
  const ifNone = req.headers.get('if-none-match')
  if (ifNone && etagActual) {
    const lista = etiquetas(ifNone)
    if (lista.includes('*') || lista.includes(etagActual)) {
      return responderError(412, 'El archivo ya existe.')
    }
  }
  const ifMatch = req.headers.get('if-match')
  if (ifMatch) {
    const lista = etiquetas(ifMatch)
    if (!etagActual || (!lista.includes('*') && !lista.includes(etagActual))) {
      return responderError(412, 'El archivo ha cambiado desde que lo abriste.')
    }
  }

  const cuerpo = await leerCuerpoLimitado(req, MAX_FILE_SIZE)
  if (!cuerpo.ok) return responderError(cuerpo.status, cuerpo.error)

  // El trigger de cupo solo salta en INSERT; en sobrescritura se comprueba el
  // delta antes de tocar R2. Si la RPC falla, el INSERT sigue protegido y la
  // sobrescritura queda sin pre-chequeo (mejor no bloquear toda la escritura).
  const uso = await usoAlmacenamiento(env)
  if (uso) {
    const delta = archivoActual ? cuerpo.tamano - archivoActual.tamano_bytes : cuerpo.tamano
    if (delta > 0 && uso.usada + delta > LIMITE_BYTES) {
      return responderError(
        507,
        'No hay espacio para este archivo: el almacenamiento familiar está en el límite de 9 GB.'
      )
    }
  }

  const tipo = mimeEfectivo(nombre, req.headers.get('content-type'))
  const key = keyNueva(user.id, padre.scope, nombre)
  try {
    await env.BUCKET.put(key, cuerpo.body, { httpMetadata: { contentType: tipo } })
  } catch {
    return responderError(500, 'No se pudo guardar el archivo en el almacenamiento.')
  }

  if (archivoActual) {
    let filas: FilaArchivo[]
    try {
      filas = await sb<FilaArchivo[]>(env, `archivos?id=eq.${archivoActual.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          ruta_r2: key,
          tamano_bytes: cuerpo.tamano,
          tipo_mime: tipo,
          fecha_subida: new Date().toISOString(),
        }),
      })
    } catch (e) {
      await borrarKey(env, key)
      return errorDeBd(e)
    }
    if (filas.length !== 1) {
      await borrarKey(env, key)
      return responderError(409, 'El archivo cambió mientras se guardaba. Inténtalo de nuevo.')
    }
    // La fila ya apunta a la key nueva; la vieja se puede borrar.
    await borrarKey(env, archivoActual.ruta_r2)
    await auditar(env, user.id, 'ACTUALIZAR_WEBDAV', {
      archivo_id: archivoActual.id,
      nombre_original: nombre,
      tamano_bytes: cuerpo.tamano,
      via: 'webdav',
    })
    return new Response(null, {
      status: 204,
      headers: { ETag: etagDe(filas[0]), ...cabecerasPrivadas() },
    })
  }

  let filas: FilaArchivo[]
  try {
    filas = await sb<FilaArchivo[]>(env, 'archivos', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        nombre_original: nombre,
        ruta_r2: key,
        tamano_bytes: cuerpo.tamano,
        tipo_mime: tipo,
        carpeta_id: padre.carpetaId,
        subido_por: user.id,
        estado: 'activo',
      }),
    })
  } catch (e) {
    await borrarKey(env, key)
    return errorDeBd(e)
  }
  if (filas.length !== 1) {
    await borrarKey(env, key)
    return responderError(500, 'No se pudo crear el registro del archivo.')
  }

  return new Response(null, {
    status: 201,
    headers: {
      ETag: etagDe(filas[0]),
      Location: hrefDe(segs, false),
      ...cabecerasPrivadas(),
    },
  })
}

// ---------------------------------------------------------------------------
// MKCOL: crear carpeta. Mismo ámbito que el padre y sin duplicados.
// ---------------------------------------------------------------------------
export async function responderMkcol(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const contentLength = (req.headers.get('content-length') ?? '').trim()
  if (contentLength !== '' && contentLength !== '0') {
    return responderError(415, 'MKCOL no admite cuerpo.')
  }

  const padre = await resolverPadre(env, user, segs)
  if (!padre.ok) return responderError(padre.status, padre.error)

  const nombre = segs[segs.length - 1]
  const motivo = nombreValido(nombre, true)
  if (motivo) return responderError(400, motivo)

  const [carpetaMisma, archivoMismo] = await Promise.all([
    carpetaHija(env, user, padre.scope, padre.carpetaId, nombre),
    archivoHijo(env, user, padre.scope, padre.carpetaId, nombre),
  ])
  if (carpetaMisma || archivoMismo) {
    return responderError(405, 'Ya existe un elemento con ese nombre.')
  }

  let filas: FilaCarpeta[]
  try {
    filas = await sb<FilaCarpeta[]>(env, 'carpetas', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        nombre,
        creado_por: user.id,
        es_privada: padre.scope === 'privado',
        carpeta_padre_id: padre.carpetaId,
      }),
    })
  } catch (e) {
    return errorDeBd(e)
  }
  if (filas.length !== 1) {
    return responderError(500, 'No se pudo crear la carpeta.')
  }

  await auditar(env, user.id, 'CREAR_CARPETA', {
    carpeta_id: filas[0].id,
    nombre,
    carpeta_padre_id: padre.carpetaId,
    via: 'webdav',
  })

  return new Response(null, {
    status: 201,
    headers: { Location: hrefDe(segs, true), ...cabecerasPrivadas() },
  })
}

// ---------------------------------------------------------------------------
// DELETE: solo archivos y solo a la papelera. Borrar carpetas queda prohibido
// en v1: la PWA tampoco tiene papelera de carpetas y el CASCADE perdería hijos.
// ---------------------------------------------------------------------------
export async function responderDelete(
  env: Env,
  user: UsuarioDav,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind !== 'archivo') {
    return responderError(
      403,
      'Borrar carpetas no está disponible desde el Explorador. Usa la app para vaciarlas o reorganizarlas.'
    )
  }
  if (nodo.archivo.subido_por !== user.id && user.rol !== 'admin') {
    return responderError(403, 'Solo el dueño o un administrador puede borrar este archivo.')
  }

  try {
    await sbVoid(env, `archivos?id=eq.${nodo.archivo.id}&estado=eq.activo`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: 'papelera',
        fecha_papelera: new Date().toISOString(),
      }),
    })
  } catch (e) {
    return errorDeBd(e)
  }

  // La auditoría MOVER_A_PAPELERA la pone el trigger trg_cambio_estado_archivo.
  return new Response(null, { status: 204, headers: cabecerasPrivadas() })
}
