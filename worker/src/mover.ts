// Fase B de escritura WebDAV: MOVE (archivo y carpeta) y COPY (solo archivos).
// Respeta las reglas de la PWA: propiedad, ámbitos, cupo de 9 GB, nombres
// válidos, papelera para el destino reemplazado y auditoría. Diseño en
// docs/diseno/webdav-escritura.md.

import {
  LIMITE_BYTES,
  MAX_SEGMENTOS,
  type Env,
  type FilaArchivo,
  type UsuarioDav,
} from './env'
import { archivoHijo, carpetaHija, esDescendiente, resolver, resolverPadre } from './arbol'
import { comprobarBloqueo } from './locks'
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
  segmentos,
} from './util'

type Destino =
  | { ok: true; segs: string[] }
  | { ok: false; status: number; error: string }

// Destination puede venir absoluto (http://host/ruta) o como ruta absoluta.
// Solo se acepta el mismo host: mover a otro servidor no tiene sentido aquí.
function leerDestino(req: Request): Destino {
  const cabecera = req.headers.get('destination')
  if (!cabecera) {
    return { ok: false, status: 400, error: 'Falta la cabecera Destination.' }
  }
  let url: URL
  try {
    url = new URL(cabecera, new URL(req.url).origin)
  } catch {
    return { ok: false, status: 400, error: 'Destination no es una URL válida.' }
  }
  if (url.host.toLowerCase() !== new URL(req.url).host.toLowerCase()) {
    return {
      ok: false,
      status: 502,
      error: 'El destino debe estar en el mismo servidor WebDAV.',
    }
  }
  const segs = segmentos(url.pathname)
  if (!segs) {
    return { ok: false, status: 400, error: 'La ruta de destino no es válida.' }
  }
  if (segs.length > MAX_SEGMENTOS) {
    return { ok: false, status: 400, error: 'La ruta de destino es demasiado profunda.' }
  }
  return { ok: true, segs }
}

function mismaRuta(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

// RFC 4918: Overwrite vale T por defecto; solo F impide reemplazar.
function permiteSobrescribir(req: Request): boolean {
  return (req.headers.get('overwrite') ?? 'T').trim().toUpperCase() !== 'F'
}

async function moverDestinoAPapelera(env: Env, archivoId: string): Promise<void> {
  await sbVoid(env, `archivos?id=eq.${archivoId}&estado=eq.activo`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      estado: 'papelera',
      fecha_papelera: new Date().toISOString(),
    }),
  })
}

// ---------------------------------------------------------------------------
// MOVE: archivo o carpeta. Un archivo puede cambiar de ámbito reubicando sus
// bytes en R2; una carpeta solo puede moverse dentro de su mismo ámbito.
// ---------------------------------------------------------------------------
export async function responderMove(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind === 'raiz' || nodo.kind === 'ambito') {
    return responderError(403, 'Las carpetas raíz no se pueden mover.')
  }

  const esCarpeta = nodo.kind === 'carpeta'
  const propietario = esCarpeta ? nodo.carpeta.creado_por : nodo.archivo.subido_por
  if (propietario !== user.id && user.rol !== 'admin') {
    return responderError(
      403,
      esCarpeta
        ? 'Solo el dueño o un administrador puede mover esta carpeta.'
        : 'Solo el dueño o un administrador puede mover este archivo.'
    )
  }

  const destino = leerDestino(req)
  if (!destino.ok) return responderError(destino.status, destino.error)
  if (mismaRuta(destino.segs, segs)) {
    return new Response(null, { status: 204, headers: cabecerasPrivadas() })
  }

  const nombre = destino.segs[destino.segs.length - 1]
  const motivo = nombreValido(nombre, esCarpeta)
  if (motivo) return responderError(400, motivo)

  const padreDestino = await resolverPadre(env, user, destino.segs)
  if (!padreDestino.ok) return responderError(padreDestino.status, padreDestino.error)

  if (esCarpeta && padreDestino.scope !== nodo.scope) {
    return responderError(
      409,
      'Una carpeta no puede cambiar de ámbito: mueve antes su contenido.'
    )
  }
  if (
    !esCarpeta &&
    padreDestino.scope === 'privado' &&
    nodo.archivo.subido_por !== user.id
  ) {
    return responderError(403, 'Solo puedes mover tus propios archivos a tu caja fuerte.')
  }

  // Se valida antes de tocar el destino: si algo falla, el archivo que hubiera
  // en el destino no se habrá mandado a la papelera.
  if (esCarpeta && padreDestino.carpetaId) {
    const dentro = await esDescendiente(env, padreDestino.carpetaId, nodo.carpeta.id)
    if (dentro) {
      return responderError(
        409,
        'No se puede mover una carpeta dentro de sí misma o de sus hijas.'
      )
    }
  }

  let objetoOrigen: R2ObjectBody | null = null
  if (!esCarpeta && nodo.scope !== padreDestino.scope) {
    try {
      objetoOrigen = await env.BUCKET.get(nodo.archivo.ruta_r2)
    } catch {
      return responderError(500, 'No se pudo leer el archivo del almacenamiento.')
    }
    if (!objetoOrigen) {
      return responderError(404, 'No se encontraron los bytes del archivo.')
    }
  }

  const [carpetaDestino, archivoDestino] = await Promise.all([
    carpetaHija(env, user, padreDestino.scope, padreDestino.carpetaId, nombre),
    archivoHijo(env, user, padreDestino.scope, padreDestino.carpetaId, nombre),
  ])

  // Mover toca el origen y el destino: ambos deben estar libres (o traer el
  // token del lock en la cabecera If). El padre del origen también cuenta:
  // sacar un miembro modifica la colección aunque el lock sea Depth: 0.
  const bloqueo = await comprobarBloqueo(env, req, [
    esCarpeta
      ? { id: nodo.carpeta.id, esCarpeta: true, padreId: null }
      : { id: nodo.archivo.id, esCarpeta: false, padreId: nodo.archivo.carpeta_id },
    ...(esCarpeta
      ? nodo.carpeta.carpeta_padre_id
        ? [{ id: nodo.carpeta.carpeta_padre_id, esCarpeta: true, padreId: null }]
        : []
      : nodo.archivo.carpeta_id
        ? [{ id: nodo.archivo.carpeta_id, esCarpeta: true, padreId: null }]
        : []),
    { id: padreDestino.carpetaId, esCarpeta: true, padreId: null },
    ...(archivoDestino
      ? [{ id: archivoDestino.id, esCarpeta: false, padreId: archivoDestino.carpeta_id }]
      : []),
  ])
  if (bloqueo) return bloqueo

  if (carpetaDestino) {
    if (!permiteSobrescribir(req)) {
      return responderError(412, 'El destino ya existe y Overwrite es F.')
    }
    return responderError(409, 'Ya existe una carpeta con ese nombre en el destino.')
  }

  let reemplazado = false
  if (archivoDestino) {
    if (!permiteSobrescribir(req)) {
      return responderError(412, 'El destino ya existe y Overwrite es F.')
    }
    if (archivoDestino.subido_por !== user.id && user.rol !== 'admin') {
      return responderError(403, 'No puedes reemplazar un archivo de otro miembro.')
    }
    // No puede ocurrir con rutas distintas, pero evita mandar a papelera el
    // propio archivo si el cliente manda una ruta equivalente.
    if (!esCarpeta && archivoDestino.id === nodo.archivo.id) {
      return new Response(null, { status: 204, headers: cabecerasPrivadas() })
    }
    try {
      await moverDestinoAPapelera(env, archivoDestino.id)
    } catch (e) {
      return errorDeBd(e)
    }
    reemplazado = true
  }

  const status = reemplazado ? 204 : 201

  if (esCarpeta) {
    const nombreAnterior = nodo.carpeta.nombre
    const padreAnterior = nodo.carpeta.carpeta_padre_id
    try {
      await sbVoid(env, `carpetas?id=eq.${nodo.carpeta.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ nombre, carpeta_padre_id: padreDestino.carpetaId }),
      })
    } catch (e) {
      return errorDeBd(e)
    }

    if (padreAnterior !== padreDestino.carpetaId) {
      await auditar(env, user.id, 'MOVER', {
        carpeta_id: nodo.carpeta.id,
        de: padreAnterior,
        a: padreDestino.carpetaId,
        via: 'webdav',
      })
    }
    if (nombreAnterior !== nombre) {
      await auditar(env, user.id, 'RENOMBRAR_CARPETA', {
        carpeta_id: nodo.carpeta.id,
        anterior: nombreAnterior,
        nuevo: nombre,
        via: 'webdav',
      })
    }

    return new Response(null, {
      status,
      headers: { Location: hrefDe(destino.segs, true), ...cabecerasPrivadas() },
    })
  }

  const archivo = nodo.archivo
  const nombreAnterior = archivo.nombre_original
  const padreAnterior = archivo.carpeta_id

  if (nodo.scope === padreDestino.scope) {
    // Mismo ámbito: la key de R2 no cambia, solo los metadatos.
    try {
      const filas = await sb<FilaArchivo[]>(
        env,
        `archivos?id=eq.${archivo.id}&estado=eq.activo`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            nombre_original: nombre,
            carpeta_id: padreDestino.carpetaId,
          }),
        }
      )
      if (filas.length !== 1) {
        return responderError(409, 'El archivo cambió mientras se movía. Inténtalo de nuevo.')
      }
    } catch (e) {
      return errorDeBd(e)
    }
  } else {
    // Cambio de ámbito: los bytes se copian a una key del ámbito nuevo y solo
    // se borra la vieja cuando la BD ya apunta a la nueva.
    if (!objetoOrigen) {
      return responderError(404, 'No se encontraron los bytes del archivo.')
    }

    const key = keyNueva(archivo.subido_por, padreDestino.scope, nombre)
    const tipo = mimeEfectivo(nombre, objetoOrigen.httpMetadata?.contentType ?? archivo.tipo_mime)
    try {
      await env.BUCKET.put(key, objetoOrigen.body, { httpMetadata: { contentType: tipo } })
    } catch {
      return responderError(500, 'No se pudo guardar el archivo en el almacenamiento.')
    }

    try {
      const filas = await sb<FilaArchivo[]>(
        env,
        `archivos?id=eq.${archivo.id}&estado=eq.activo`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            ruta_r2: key,
            nombre_original: nombre,
            carpeta_id: padreDestino.carpetaId,
          }),
        }
      )
      if (filas.length !== 1) {
        await borrarKey(env, key)
        return responderError(409, 'El archivo cambió mientras se movía. Inténtalo de nuevo.')
      }
    } catch (e) {
      await borrarKey(env, key)
      return errorDeBd(e)
    }
    await borrarKey(env, archivo.ruta_r2)
  }

  if (padreAnterior !== padreDestino.carpetaId) {
    await auditar(env, user.id, 'MOVER', {
      archivo_id: archivo.id,
      nombre_original: nombre,
      de: padreAnterior,
      a: padreDestino.carpetaId,
      via: 'webdav',
    })
  }
  if (nombreAnterior !== nombre) {
    await auditar(env, user.id, 'RENOMBRAR_ARCHIVO', {
      archivo_id: archivo.id,
      anterior: nombreAnterior,
      nuevo: nombre,
      via: 'webdav',
    })
  }

  return new Response(null, {
    status,
    headers: {
      ETag: etagDe(archivo),
      Location: hrefDe(destino.segs, false),
      ...cabecerasPrivadas(),
    },
  })
}

// ---------------------------------------------------------------------------
// COPY: solo archivos. El duplicado suma bytes al cupo y pertenece a quien
// copia. Copiar carpetas queda fuera de v1 (sería recursivo).
// ---------------------------------------------------------------------------
export async function responderCopy(
  env: Env,
  user: UsuarioDav,
  req: Request,
  segs: string[]
): Promise<Response> {
  const nodo = await resolver(env, user, segs)
  if (!nodo) return responderError(404, 'No encontrado.')
  if (nodo.kind === 'raiz' || nodo.kind === 'ambito') {
    return responderError(403, 'Las carpetas raíz no se pueden copiar.')
  }
  if (nodo.kind === 'carpeta') {
    return responderError(501, 'Copiar carpetas todavía no está disponible desde el Explorador.')
  }

  const archivo = nodo.archivo
  if (archivo.subido_por !== user.id && user.rol !== 'admin') {
    return responderError(403, 'Solo el dueño o un administrador puede copiar este archivo.')
  }

  const destino = leerDestino(req)
  if (!destino.ok) return responderError(destino.status, destino.error)
  if (mismaRuta(destino.segs, segs)) {
    return responderError(403, 'El origen y el destino de COPY no pueden ser iguales.')
  }

  const nombre = destino.segs[destino.segs.length - 1]
  const motivo = nombreValido(nombre, false)
  if (motivo) return responderError(400, motivo)

  const padreDestino = await resolverPadre(env, user, destino.segs)
  if (!padreDestino.ok) return responderError(padreDestino.status, padreDestino.error)

  const [carpetaDestino, archivoDestino] = await Promise.all([
    carpetaHija(env, user, padreDestino.scope, padreDestino.carpetaId, nombre),
    archivoHijo(env, user, padreDestino.scope, padreDestino.carpetaId, nombre),
  ])

  if (carpetaDestino) {
    return responderError(409, 'Ya existe una carpeta con ese nombre en el destino.')
  }
  if (archivoDestino && !permiteSobrescribir(req)) {
    return responderError(412, 'El destino ya existe y Overwrite es F.')
  }
  if (archivoDestino && archivoDestino.subido_por !== user.id && user.rol !== 'admin') {
    return responderError(403, 'No puedes reemplazar un archivo de otro miembro.')
  }

  // COPY solo escribe en el destino; el origen se lee sin bloquear.
  const bloqueo = await comprobarBloqueo(env, req, [
    { id: padreDestino.carpetaId, esCarpeta: true, padreId: null },
    ...(archivoDestino
      ? [{ id: archivoDestino.id, esCarpeta: false, padreId: archivoDestino.carpeta_id }]
      : []),
  ])
  if (bloqueo) return bloqueo

  // El cupo cuenta solo archivos activos: si se reemplaza un archivo, sus bytes
  // salen del cómputo al ir a la papelera. Se comprueba antes de destruir nada.
  const uso = await usoAlmacenamiento(env)
  if (uso) {
    const liberado = archivoDestino?.tamano_bytes ?? 0
    if (uso.usada - liberado + archivo.tamano_bytes > LIMITE_BYTES) {
      return responderError(
        507,
        'No hay espacio para la copia: el almacenamiento familiar está en el límite de 9 GB.'
      )
    }
  }

  let objeto: R2ObjectBody | null
  try {
    objeto = await env.BUCKET.get(archivo.ruta_r2)
  } catch {
    return responderError(500, 'No se pudo leer el archivo del almacenamiento.')
  }
  if (!objeto) {
    return responderError(404, 'No se encontraron los bytes del archivo.')
  }

  let reemplazado = false
  if (archivoDestino) {
    try {
      await moverDestinoAPapelera(env, archivoDestino.id)
    } catch (e) {
      return errorDeBd(e)
    }
    reemplazado = true
  }

  const key = keyNueva(user.id, padreDestino.scope, nombre)
  const tipo = mimeEfectivo(nombre, objeto.httpMetadata?.contentType ?? archivo.tipo_mime)
  try {
    await env.BUCKET.put(key, objeto.body, { httpMetadata: { contentType: tipo } })
  } catch {
    return responderError(500, 'No se pudo guardar la copia en el almacenamiento.')
  }

  let filas: FilaArchivo[]
  try {
    filas = await sb<FilaArchivo[]>(env, 'archivos', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        nombre_original: nombre,
        ruta_r2: key,
        tamano_bytes: archivo.tamano_bytes,
        tipo_mime: tipo,
        carpeta_id: padreDestino.carpetaId,
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
    return responderError(500, 'No se pudo registrar la copia.')
  }

  await auditar(env, user.id, 'COPIAR_WEBDAV', {
    archivo_id: filas[0].id,
    origen_id: archivo.id,
    nombre_original: nombre,
    via: 'webdav',
  })

  return new Response(null, {
    status: reemplazado ? 204 : 201,
    headers: {
      ETag: etagDe(filas[0]),
      Location: hrefDe(destino.segs, false),
      ...cabecerasPrivadas(),
    },
  })
}
