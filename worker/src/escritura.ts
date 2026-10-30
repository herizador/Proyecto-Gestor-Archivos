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
import { comprobarBloqueo } from './locks'
import { auditar, errorDeBd, sb, sbVoid, usoAlmacenamiento } from './supabase'
import {
  borrarKey,
  cabecerasPrivadas,
  etagDe,
  hrefDe,
  keyNueva,
  leerCuerpoLimitado,
  mimeEfectivo,
  nombreValido,
  responderError,
} from './util'

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

  // Un bloqueo activo (del propio archivo o de una carpeta superior con
  // profundidad infinita) exige el token en la cabecera If.
  const bloqueo = await comprobarBloqueo(env, user, req, [
    archivoActual
      ? { id: archivoActual.id, esCarpeta: false, padreId: archivoActual.carpeta_id }
      : { id: padre.carpetaId, esCarpeta: true, padreId: null },
  ])
  if (bloqueo) return bloqueo

  const cuerpo = await leerCuerpoLimitado(
    req,
    MAX_FILE_SIZE,
    'El archivo supera el límite de 20 MB.'
  )
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

  // Crear un hijo modifica la carpeta: un lock de la carpeta (o de un
  // ancestro con profundidad infinita) debe aportar su token.
  const bloqueo = await comprobarBloqueo(env, user, req, [
    { id: padre.carpetaId, esCarpeta: true, padreId: null },
  ])
  if (bloqueo) return bloqueo

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
  req: Request,
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

  const bloqueo = await comprobarBloqueo(env, user, req, [
    { id: nodo.archivo.id, esCarpeta: false, padreId: nodo.archivo.carpeta_id },
    // Borrar el archivo lo quita de su carpeta: un lock Depth: 0 del padre
    // también protege el conjunto de miembros.
    ...(nodo.archivo.carpeta_id
      ? [{ id: nodo.archivo.carpeta_id, esCarpeta: true, padreId: null }]
      : []),
  ])
  if (bloqueo) return bloqueo

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
