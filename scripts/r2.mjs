#!/usr/bin/env node
// Diagnóstico de Cloudflare R2 y política CORS.
// Uso:
//   node --env-file=.env.local scripts/r2.mjs diagnostico
//   node --env-file=.env.local scripts/r2.mjs cors            (solo muestra)
//   node --env-file=.env.local scripts/r2.mjs cors --aplicar  (escribe)
// Añade --eu para usar el endpoint de jurisdicción europea.
import https from 'node:https'
import {
  S3Client,
  HeadBucketCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME
const ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT
const ACCESS = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID
const SECRET = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY

if (!BUCKET || !ENDPOINT || !ACCESS || !SECRET) {
  console.error('Faltan variables CLOUDFLARE_R2_*. Ejecuta con: node --env-file=.env.local scripts/r2.mjs diagnostico')
  process.exit(1)
}

const ORIGENES = ['http://localhost:3000', 'https://proyecto-gestor-archivos.vercel.app']
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
if (appUrl && appUrl !== 'https://vercel.app' && !ORIGENES.includes(appUrl)) ORIGENES.push(appUrl)

const REGLAS_CORS = [
  {
    AllowedOrigins: ORIGENES,
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
]

const usarEU = process.argv.includes('--eu')

function aEU(endpoint) {
  return endpoint.replace(/\.r2\.cloudflarestorage\.com$/, '.eu.r2.cloudflarestorage.com')
}

function cliente(endpoint) {
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  })
}

// Corta cada petición a los 25 s: con la red bloqueada el socket se queda colgado.
function enviar(s3, comando) {
  return s3.send(comando, { abortSignal: AbortSignal.timeout(25000) })
}

// Sonda TLS sin validar el certificado: permite ver quién responde de verdad
// (Cloudflare devuelve XML; la página de bloqueo de LaLiga devuelve HTML).
function sonda(endpoint) {
  return new Promise((resolve) => {
    const url = new URL(endpoint)
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: '/',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 20000,
      },
      (res) => {
        res.resume()
        resolve({
          status: res.statusCode,
          server: res.headers.server ?? '(sin cabecera)',
          tipo: res.headers['content-type'] ?? '(sin cabecera)',
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ error: e.message }))
    req.end()
  })
}

async function diagnostico() {
  console.log(`Bucket: ${BUCKET}\n`)
  const endpoints = [['configurado', ENDPOINT]]
  const eu = aEU(ENDPOINT)
  if (eu !== ENDPOINT) endpoints.push(['EU', eu])

  for (const [nombre, endpoint] of endpoints) {
    console.log(`── ${nombre}: ${endpoint}`)
    const r = await sonda(endpoint)
    if (r.error) {
      console.log(`   red:  ERROR ${r.error}`)
    } else {
      console.log(`   red:  HTTP ${r.status} · Server: ${r.server} · ${r.tipo}`)
      if (String(r.server).toLowerCase() === 'nginx' || String(r.tipo).includes('text/html')) {
        console.log('   ⚠️  Eso NO es R2: es una página de bloqueo (LaLiga/ISP).')
      }
    }

    const s3 = cliente(endpoint)
    try {
      await enviar(s3, new HeadBucketCommand({ Bucket: BUCKET }))
      console.log('   auth: bucket accesible ✓')
      try {
        const cors = await enviar(s3, new GetBucketCorsCommand({ Bucket: BUCKET }))
        console.log('   CORS:', JSON.stringify(cors.CORSRules ?? [], null, 2))
      } catch (e) {
        if (e.name === 'NoSuchCORSConfiguration') console.log('   CORS: sin política configurada')
        else console.log(`   CORS: no se pudo leer (${e.name}${e.$metadata?.httpStatusCode ? ` HTTP ${e.$metadata.httpStatusCode}` : ''})`)
      }
    } catch (e) {
      const status = e.$metadata?.httpStatusCode
      if (status) console.log(`   auth: R2 respondió HTTP ${status} (${e.name})`)
      else console.log(`   auth: sin respuesta de R2 (${e.name}: ${e.message})`)
    } finally {
      s3.destroy()
    }
    console.log('')
  }

  if (process.argv.includes('--escritura')) {
    console.log('── Prueba de escritura (objeto temporal)')
    await pruebaEscritura()
  }
}

// Prueba de escritura real (objeto temporal que se borra al terminar).
// Confirma que las credenciales y la jurisdicción del endpoint sirven para subir.
async function pruebaEscritura() {
  for (const [nombre, endpoint] of [
    ['configurado', ENDPOINT],
    ['EU', aEU(ENDPOINT)],
  ]) {
    if (nombre === 'EU' && endpoint === ENDPOINT) continue
    const s3 = cliente(endpoint)
    const key = `diagnostico/r2-${Date.now()}-${nombre.toLowerCase()}.txt`
    try {
      await enviar(s3, 
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'prueba', ContentType: 'text/plain' })
      )
      await enviar(s3, new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
      await enviar(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      console.log(`✅ ${nombre}: PUT + HEAD + DELETE correctos en ${endpoint}`)
    } catch (e) {
      const status = e.$metadata?.httpStatusCode
      console.log(
        `❌ ${nombre}: ${e.name}${status ? ` HTTP ${status}` : ''} · ${e.message.slice(0, 160)}`
      )
      try {
        await enviar(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      } catch {
        /* si no se subió, no hay nada que borrar */
      }
    } finally {
      s3.destroy()
    }
  }
}

async function cors() {
  const aplicar = process.argv.includes('--aplicar')
  const endpoint = usarEU ? aEU(ENDPOINT) : ENDPOINT
  console.log(`Bucket: ${BUCKET}`)
  console.log(`Endpoint: ${endpoint}`)
  console.log(`Orígenes permitidos: ${ORIGENES.join(', ')}\n`)

  const s3 = cliente(endpoint)
  try {
    let actual = null
    try {
      actual = (await enviar(s3, new GetBucketCorsCommand({ Bucket: BUCKET }))).CORSRules ?? []
    } catch (e) {
      if (e.name !== 'NoSuchCORSConfiguration') throw e
    }

    if (actual) console.log('Política actual:', JSON.stringify(actual, null, 2))
    else console.log('Política actual: (ninguna)')

    if (!aplicar) {
      console.log('\nSe aplicaría:', JSON.stringify(REGLAS_CORS, null, 2))
      console.log('\nAñade --aplicar para escribirla.')
      return
    }

    await enviar(s3, 
      new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: REGLAS_CORS } })
    )
    console.log('\n✅ Política CORS aplicada. Comprobando…')
    const despues = (await enviar(s3, new GetBucketCorsCommand({ Bucket: BUCKET }))).CORSRules ?? []
    console.log(JSON.stringify(despues, null, 2))
  } finally {
    s3.destroy()
  }
}

const comando = process.argv[2]
if (comando === 'diagnostico') await diagnostico()
else if (comando === 'cors') await cors()
else {
  console.log('Uso: node --env-file=.env.local scripts/r2.mjs <diagnostico|cors> [--aplicar] [--eu]')
  process.exit(1)
}
