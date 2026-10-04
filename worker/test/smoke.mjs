// Prueba de humo del puente WebDAV (requiere el Worker desplegado y un token real).
// Uso: node worker/test/smoke.mjs <base> <email> <token> [ruta-archivo]
//   base:         https://gestor-familiar.id386827.workers.dev
//   ruta-archivo: opcional, p. ej. "/Área común/Carpeta/doc.pdf" (prueba GET + Range)
// Nunca commitees el token: pásalo por línea de comandos.

const [base, email, token, rutaArchivo] = process.argv.slice(2)
if (!base || !email || !token) {
  console.error('Uso: node worker/test/smoke.mjs <base> <email> <token> [ruta-archivo]')
  process.exit(2)
}

const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
let fallos = 0

async function caso(nombre, fn) {
  try {
    await fn()
    console.log(`PASS  ${nombre}`)
  } catch (e) {
    fallos += 1
    console.log(`FAIL  ${nombre} → ${e instanceof Error ? e.message : e}`)
  }
}

function afirma(cond, msg) {
  if (!cond) throw new Error(msg)
}

await caso('OPTIONS anuncia DAV', async () => {
  const r = await fetch(base, { method: 'OPTIONS' })
  afirma(r.status === 200, `status ${r.status}`)
  afirma((r.headers.get('dav') ?? '') === '1', 'sin cabecera DAV: 1')
})

await caso('PROPFIND sin auth → 401 con reto Basic', async () => {
  const r = await fetch(base, { method: 'PROPFIND', headers: { Depth: '1' } })
  afirma(r.status === 401, `status ${r.status}`)
  afirma((r.headers.get('www-authenticate') ?? '').startsWith('Basic'), 'sin reto Basic')
})

await caso('PROPFIND raíz con auth → 207 con ámbitos', async () => {
  const r = await fetch(base, { method: 'PROPFIND', headers: { Depth: '1', Authorization: auth } })
  afirma(r.status === 207, `status ${r.status}`)
  const xml = await r.text()
  afirma(xml.includes('rea com'), 'la raíz no lista el ámbito común')
})

await caso('PROPFIND con tildes/UTF-8 → 207', async () => {
  const r = await fetch(`${base}/%C3%81rea%20com%C3%BAn/`, {
    method: 'PROPFIND',
    headers: { Depth: '1', Authorization: auth },
  })
  afirma(r.status === 207, `status ${r.status}`)
})

await caso('PUT → 501 (solo lectura)', async () => {
  const r = await fetch(`${base}/prueba.txt`, {
    method: 'PUT',
    headers: { Authorization: auth },
    body: 'hola',
  })
  afirma(r.status === 501, `status ${r.status}`)
})

if (rutaArchivo) {
  const url = base + rutaArchivo.split('/').map((s) => encodeURIComponent(s)).join('/')
  await caso('GET archivo → 200 con bytes', async () => {
    const r = await fetch(url, { headers: { Authorization: auth } })
    afirma(r.status === 200, `status ${r.status}`)
    const buf = await r.arrayBuffer()
    afirma(buf.byteLength > 0, 'cuerpo vacío')
  })
  await caso('GET con Range → 206 parcial', async () => {
    const r = await fetch(url, { headers: { Authorization: auth, Range: 'bytes=0-99' } })
    afirma(r.status === 206, `status ${r.status}`)
    afirma((r.headers.get('content-range') ?? '').startsWith('bytes 0-99/'), 'sin Content-Range')
  })
} else {
  console.log('SKIP  GET/Range (pasa una ruta de archivo como 4º argumento)')
}

console.log(fallos === 0 ? '\nTodo OK' : `\n${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
