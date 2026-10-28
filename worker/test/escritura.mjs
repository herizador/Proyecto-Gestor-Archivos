// Prueba de humo de la escritura WebDAV (requiere el Worker desplegado con
// DAV_WRITE="admin" o "all" y un token real).
// Uso: node worker/test/escritura.mjs <base> <email> <token> <carpeta>
//   base:    https://gestor-familiar.id386827.workers.dev
//   carpeta: ruta existente, p. ej. "/Área común/Documentos" o "/Mi caja fuerte"
//
// Crea un archivo temporal, lo sobrescribe, comprueba GET/PROPFIND y lo manda a
// la papelera. No crea carpetas: MKCOL se prueba en local para no dejar basura.
// Nunca commitees el token: pásalo por línea de comandos.

const [baseArg, email, token, carpetaArg] = process.argv.slice(2)
if (!baseArg || !email || !token || !carpetaArg) {
  console.error('Uso: node worker/test/escritura.mjs <base> <email> <token> <carpeta>')
  process.exit(2)
}

const base = baseArg.replace(/\/+$/, '')
const carpeta = carpetaArg.replace(/\/+$/, '')
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
const nombre = `prueba-webdav-${Date.now()}.txt`
const cuerpoInicial = `hola webdav ${Date.now()}`
const cuerpoFinal = `adios webdav ${Date.now()}`

function rutaArchivo(carpetaUrl, nombreArchivo) {
  return `${carpetaUrl}/${encodeURIComponent(nombreArchivo)}`
}

const carpetaUrl = carpeta
  .split('/')
  .filter(Boolean)
  .map(encodeURIComponent)
  .reduce((acc, s) => `${acc}/${s}`, base)
const archivoUrl = rutaArchivo(carpetaUrl, nombre)

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
await caso('OPTIONS anuncia escritura', async () => {
  const r = await fetch(base, { method: 'OPTIONS' })
  afirma(r.status === 200, `status ${r.status}`)
  const allow = r.headers.get('allow') ?? ''
  escrituraActiva = allow.includes('PUT') && allow.includes('MKCOL') && allow.includes('DELETE')
  afirma(escrituraActiva, `Allow sin escritura: ${allow}`)
})
if (!escrituraActiva) {
  console.log('\nDAV_WRITE está en "0": activa "admin" o "all" en worker/wrangler.toml y redespliega.')
  process.exit(1)
}

try {
  await caso('PUT nuevo → 201', async () => {
    const r = await fetch(archivoUrl, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: cuerpoInicial,
    })
    afirma(r.status === 201, `status ${r.status} ${await r.text()}`)
    afirma(!!r.headers.get('etag'), 'sin ETag')
  })

  await caso('GET devuelve los bytes', async () => {
    const r = await fetch(archivoUrl, { headers: { Authorization: auth } })
    afirma(r.status === 200, `status ${r.status}`)
    afirma((await r.text()) === cuerpoInicial, 'contenido distinto')
  })

  await caso('PUT sobrescritura → 204', async () => {
    const r = await fetch(archivoUrl, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: cuerpoFinal,
    })
    afirma(r.status === 204, `status ${r.status} ${await r.text()}`)
  })

  await caso('GET devuelve la versión nueva', async () => {
    const r = await fetch(archivoUrl, { headers: { Authorization: auth } })
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

  await caso('DELETE archivo → 204', async () => {
    const r = await fetch(archivoUrl, { method: 'DELETE', headers: { Authorization: auth } })
    afirma(r.status === 204, `status ${r.status}`)
  })

  await caso('GET tras DELETE → 404', async () => {
    const r = await fetch(archivoUrl, { headers: { Authorization: auth } })
    afirma(r.status === 404, `status ${r.status}`)
  })

  await caso('DELETE carpeta → 403', async () => {
    const r = await fetch(`${carpetaUrl}/`, { method: 'DELETE', headers: { Authorization: auth } })
    afirma(r.status === 403, `status ${r.status}`)
  })

  await caso('PUT en la raíz → 409', async () => {
    const r = await fetch(`${base}/suelto-${Date.now()}.txt`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/plain' },
      body: 'x',
    })
    afirma(r.status === 409, `status ${r.status}`)
  })
} finally {
  // Limpieza si algún caso falló antes del DELETE.
  await fetch(archivoUrl, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => undefined)
}

console.log(fallos === 0 ? '\nTodo OK' : `\n${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
