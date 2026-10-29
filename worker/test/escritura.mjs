// Prueba de humo de la escritura WebDAV (requiere el Worker desplegado con
// DAV_WRITE="admin" o "all" y un token real).
// Uso: node worker/test/escritura.mjs <base> <email> <token> <carpeta>
//   base:    https://gestor-familiar.id386827.workers.dev
//   carpeta: ruta existente, p. ej. "/Área común/Documentos" o "/Mi caja fuerte"
//
// Crea un archivo temporal, lo sobrescribe, prueba COPY/MOVE/PROPPATCH y lo
// manda a la papelera. No crea carpetas: MKCOL y MOVE de carpetas se prueban
// en local para no dejar basura. Nunca commitees el token: pásalo por CLI.

const [baseArg, email, token, carpetaArg] = process.argv.slice(2)
if (!baseArg || !email || !token || !carpetaArg) {
  console.error('Uso: node worker/test/escritura.mjs <base> <email> <token> <carpeta>')
  process.exit(2)
}

const base = baseArg.replace(/\/+$/, '')
const carpeta = carpetaArg.replace(/\/+$/, '')
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
const sello = Date.now()
const nombre = `prueba-webdav-${sello}.txt`
const nombreCopia = `prueba-webdav-${sello}-copia.txt`
const nombreProppatch = `prueba-webdav-${sello}-pp.txt`
const nombreFinal = `prueba-webdav-${sello}-final.txt`
const cuerpoInicial = `hola webdav ${sello}`
const cuerpoFinal = `adios webdav ${sello}`

function urlRuta(segs) {
  return segs.reduce((acc, s) => `${acc}/${encodeURIComponent(s)}`, base)
}

const carpetaSegs = carpeta.split('/').filter(Boolean)
const carpetaUrl = urlRuta(carpetaSegs)
function rutaArchivo(carpetaBase, nombreArchivo) {
  return `${carpetaBase}/${encodeURIComponent(nombreArchivo)}`
}
function archivoUrl(nombreArchivo) {
  return rutaArchivo(carpetaUrl, nombreArchivo)
}
function xmlProppatch(nuevo, extra = '') {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">` +
    `<D:set><D:prop><D:displayname>${nuevo}</D:displayname>${extra}</D:prop></D:set>` +
    '</D:propertyupdate>'
  )
}

let fallos = 0
async function caso(nombreCaso, fn) {
  try {
    await fn()
    console.log(`PASS  ${nombreCaso}`)
  } catch (e) {
    fallos += 1
    console.log(`FAIL  ${nombreCaso} → ${e instanceof Error ? e.message : e}`)
  }
}
function afirma(cond, msg) {
  if (!cond) throw new Error(msg)
}

let escrituraActiva = false
await caso('OPTIONS anuncia escritura completa', async () => {
  const r = await fetch(base, { method: 'OPTIONS' })
  afirma(r.status === 200, `status ${r.status}`)
  const allow = r.headers.get('allow') ?? ''
  escrituraActiva = ['PUT', 'MKCOL', 'DELETE', 'MOVE', 'COPY', 'PROPPATCH'].every((m) =>
    allow.includes(m)
  )
  afirma(escrituraActiva, `Allow sin escritura completa: ${allow}`)
})
if (!escrituraActiva) {
  console.log('\nDAV_WRITE está en "0": activa "admin" o "all" en worker/wrangler.toml y redespliega.')
  process.exit(1)
}

try {
  await caso('PUT nuevo → 201', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: cuerpoInicial,
    })
    afirma(r.status === 201, `status ${r.status} ${await r.text()}`)
    afirma(!!r.headers.get('etag'), 'sin ETag')
  })

  await caso('GET devuelve los bytes', async () => {
    const r = await fetch(archivoUrl(nombre), { headers: { Authorization: auth } })
    afirma(r.status === 200, `status ${r.status}`)
    afirma((await r.text()) === cuerpoInicial, 'contenido distinto')
  })

  await caso('PUT sobrescritura → 204', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: cuerpoFinal,
    })
    afirma(r.status === 204, `status ${r.status} ${await r.text()}`)
  })

  await caso('GET devuelve la versión nueva', async () => {
    const r = await fetch(archivoUrl(nombre), { headers: { Authorization: auth } })
    afirma(r.status === 200, `status ${r.status}`)
    afirma((await r.text()) === cuerpoFinal, 'contenido antiguo')
  })

  await caso('PROPFIND de la carpeta lo lista', async () => {
    const r = await fetch(`${carpetaUrl}/`, {
      method: 'PROPFIND',
      headers: { Authorization: auth, Depth: '1' },
    })
    afirma(r.status === 207, `status ${r.status}`)
    afirma((await r.text()).includes(nombre), 'no aparece en el listado')
  })

  await caso('COPY archivo → 201 y bytes idénticos', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'COPY',
      headers: { Authorization: auth, Destination: archivoUrl(nombreCopia) },
    })
    afirma(r.status === 201, `status ${r.status} ${await r.text()}`)
    const g = await fetch(archivoUrl(nombreCopia), { headers: { Authorization: auth } })
    afirma(g.status === 200, `GET copia ${g.status}`)
    afirma((await g.text()) === cuerpoFinal, 'bytes de la copia distintos')
  })

  await caso('COPY sobre sí mismo → 403', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'COPY',
      headers: { Authorization: auth, Destination: archivoUrl(nombre) },
    })
    afirma(r.status === 403, `status ${r.status}`)
  })

  await caso('MOVE con Overwrite:F sobre existente → 412', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'MOVE',
      headers: {
        Authorization: auth,
        Destination: archivoUrl(nombreCopia),
        Overwrite: 'F',
      },
    })
    afirma(r.status === 412, `status ${r.status}`)
  })

  await caso('MOVE con Overwrite:T reemplaza el destino → 204', async () => {
    const r = await fetch(archivoUrl(nombre), {
      method: 'MOVE',
      headers: { Authorization: auth, Destination: archivoUrl(nombreCopia) },
    })
    afirma(r.status === 204, `status ${r.status} ${await r.text()}`)
    const g = await fetch(archivoUrl(nombreCopia), { headers: { Authorization: auth } })
    afirma(g.status === 200, `GET destino ${g.status}`)
    afirma((await g.text()) === cuerpoFinal, 'bytes incorrectos tras MOVE')
    const viejo = await fetch(archivoUrl(nombre), { headers: { Authorization: auth } })
    afirma(viejo.status === 404, `el origen sigue existiendo: ${viejo.status}`)
  })

  // Solo tiene sentido si la carpeta de prueba está en el Área común.
  if (carpetaSegs[0] === 'Área común') {
    await caso('MOVE cruza a la caja fuerte y vuelve → 201', async () => {
      const privada = urlRuta(['Mi caja fuerte', nombreCopia])
      const ida = await fetch(archivoUrl(nombreCopia), {
        method: 'MOVE',
        headers: { Authorization: auth, Destination: privada },
      })
      afirma(ida.status === 201, `ida ${ida.status} ${await ida.text()}`)
      const enPrivada = await fetch(privada, { headers: { Authorization: auth } })
      afirma(enPrivada.status === 200, `GET privado ${enPrivada.status}`)
      afirma((await enPrivada.text()) === cuerpoFinal, 'bytes privados incorrectos')

      const vuelta = await fetch(privada, {
        method: 'MOVE',
        headers: { Authorization: auth, Destination: archivoUrl(nombreCopia) },
      })
      afirma(vuelta.status === 201, `vuelta ${vuelta.status} ${await vuelta.text()}`)
      const enComun = await fetch(archivoUrl(nombreCopia), { headers: { Authorization: auth } })
      afirma(enComun.status === 200, `GET común ${enComun.status}`)
      afirma((await enComun.text()) === cuerpoFinal, 'bytes comunes incorrectos')
    })
  } else {
    console.log('SKIP  MOVE entre ámbitos (la carpeta de prueba no es del Área común)')
  }

  await caso('PROPPATCH[displayname] renombra → 207', async () => {
    const r = await fetch(archivoUrl(nombreCopia), {
      method: 'PROPPATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/xml; charset=utf-8' },
      body: xmlProppatch(nombreProppatch),
    })
    afirma(r.status === 207, `status ${r.status}`)
    afirma((await r.text()).includes('200 OK'), 'sin 200 para displayname')
    const g = await fetch(archivoUrl(nombreProppatch), { headers: { Authorization: auth } })
    afirma(g.status === 200, `GET renombrado ${g.status}`)
    const viejo = await fetch(archivoUrl(nombreCopia), { headers: { Authorization: auth } })
    afirma(viejo.status === 404, `el nombre viejo sigue: ${viejo.status}`)
  })

  await caso('PROPPATCH acepta displayname y rechaza Win32 → 207', async () => {
    const r = await fetch(archivoUrl(nombreProppatch), {
      method: 'PROPPATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/xml; charset=utf-8' },
      body: xmlProppatch(
        nombreFinal,
        '<Z:Win32LastModifiedTime>2026-01-01T00:00:00Z</Z:Win32LastModifiedTime>'
      ),
    })
    afirma(r.status === 207, `status ${r.status}`)
    const xml = await r.text()
    afirma(xml.includes('200 OK'), 'displayname rechazado')
    afirma(xml.includes('403 Forbidden'), 'Win32 no rechazado')
    const g = await fetch(archivoUrl(nombreFinal), { headers: { Authorization: auth } })
    afirma(g.status === 200, `GET final ${g.status}`)
  })

  await caso('DELETE archivo → 204', async () => {
    const r = await fetch(archivoUrl(nombreFinal), {
      method: 'DELETE',
      headers: { Authorization: auth },
    })
    afirma(r.status === 204, `status ${r.status}`)
  })

  await caso('GET tras DELETE → 404', async () => {
    const r = await fetch(archivoUrl(nombreFinal), { headers: { Authorization: auth } })
    afirma(r.status === 404, `status ${r.status}`)
  })

  await caso('DELETE carpeta → 403', async () => {
    const r = await fetch(`${carpetaUrl}/`, { method: 'DELETE', headers: { Authorization: auth } })
    afirma(r.status === 403, `status ${r.status}`)
  })

  await caso('PUT en la raíz → 409', async () => {
    const r = await fetch(`${base}/suelto-${sello}.txt`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: 'x',
    })
    afirma(r.status === 409, `status ${r.status}`)
  })
} finally {
  // Limpieza si algún caso falló antes del DELETE: todos los nombres posibles.
  for (const n of [nombre, nombreCopia, nombreProppatch, nombreFinal]) {
    await fetch(archivoUrl(n), { method: 'DELETE', headers: { Authorization: auth } }).catch(
      () => undefined
    )
  }
  // Si el MOVE entre ámbitos falló a medias, también puede quedar en la caja fuerte.
  await fetch(urlRuta(['Mi caja fuerte', nombreCopia]), {
    method: 'DELETE',
    headers: { Authorization: auth },
  }).catch(() => undefined)
}

console.log(fallos === 0 ? '\nTodo OK' : `\n${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
