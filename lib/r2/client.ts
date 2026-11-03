import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { toBrowserSafePresignedUrl } from '@/lib/presigned-url'
import {
  normalizarTipoMime,
  nombreParaCabecera,
  tipoParaVista,
  tipoSeguroParaInline,
} from '@/lib/archivos-seguros'

if (!process.env.CLOUDFLARE_R2_ENDPOINT) throw new Error('CLOUDFLARE_R2_ENDPOINT no definido')
if (!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID) throw new Error('CLOUDFLARE_R2_ACCESS_KEY_ID no definido')
if (!process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) throw new Error('CLOUDFLARE_R2_SECRET_ACCESS_KEY no definido')

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
  // Evita que el SDK inyecte x-amz-checksum-* en URLs firmadas (R2 no los soporta igual que S3)
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME ?? 'gestor-archivos-familia'

async function presignAndNormalize(
  command: GetObjectCommand | PutObjectCommand,
  expiresIn: number
): Promise<string> {
  const signed = await getSignedUrl(r2Client, command, { expiresIn })
  return toBrowserSafePresignedUrl(signed)
}

function sanitizeFileNameForDisposition(fileName: string): string {
  return nombreParaCabecera(fileName)
}

/**
 * Genera una URL pre-firmada para VISUALIZAR en el navegador.
 * Solo los tipos seguros se sirven inline; HTML/SVG/XML/JS se fuerzan como
 * descarga binaria para que un archivo subido no ejecute contenido activo.
 */
export async function getPresignedViewUrl(
  key: string,
  contentType?: string,
  expiresIn = 900
): Promise<string> {
  const seguro = tipoSeguroParaInline(contentType)
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: seguro ? 'inline' : 'attachment',
    ResponseContentType: seguro ? tipoParaVista(contentType) : 'application/octet-stream',
  })
  return presignAndNormalize(command, expiresIn)
}

/**
 * Genera una URL pre-firmada de DESCARGA con nombre de archivo forzado (attachment).
 */
export async function getPresignedDownloadUrl(
  key: string,
  fileName: string,
  expiresIn = 900
): Promise<string> {
  const safeName = sanitizeFileNameForDisposition(fileName)
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  })
  return presignAndNormalize(command, expiresIn)
}

/**
 * Genera una URL pre-firmada de SUBIDA válida por `expiresIn` segundos (por defecto 5 min).
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = 300
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: normalizarTipoMime(contentType),
    // Se firma el tamaño declarado: el navegador envía Content-Length de forma
    // automática y, si el fichero real no coincide, R2 rechaza la firma. Así una
    // URL de subida no sirve para colar objetos mucho mayores de 20 MB.
    ContentLength: contentLength,
  })
  return presignAndNormalize(command, expiresIn)
}

/**
 * Tamaño real del objeto en R2. Devuelve null si no existe o no se puede leer:
 * el llamador debe tratarlo como subida incompleta, nunca como 0 bytes.
 */
export async function getR2ObjectSize(key: string): Promise<number | null> {
  try {
    const cabeceras = await r2Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key })
    )
    return typeof cabeceras.ContentLength === 'number' ? cabeceras.ContentLength : null
  } catch {
    return null
  }
}

/**
 * Elimina un objeto de R2 definitivamente. Solo llamar tras confirmar en BD.
 */
export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  await r2Client.send(command)
}

/**
 * Sube un buffer directamente a R2 desde el servidor (staging del Share Target).
 * No usa URL pre-firmada: el servidor ya tiene las credenciales.
 */
export async function putToR2(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: normalizarTipoMime(contentType),
  })
  await r2Client.send(command)
}

/**
 * Mueve un objeto dentro del bucket (staging → destino definitivo).
 * R2/S3 no tiene "rename": es Copy + Delete. Si el borrado falla tras copiar,
 * se lanza error para que el llamador limpie; el objeto queda duplicado pero
 * nunca se pierde el fichero.
 */
export async function moverEnR2(origenKey: string, destinoKey: string): Promise<void> {
  await r2Client.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${origenKey}`,
    Key: destinoKey,
  }))
  await deleteFromR2(origenKey)
}

/**
 * Key temporal del staging del Share Target. Siempre bajo el prefijo
 * `compartidos-pendientes/<uid>/` para poder auditar y limpiar abandonos.
 */
export function buildStagingKey(params: {
  userId: string
  fileName: string
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const sello = `${Date.now()}_${randomUUID().slice(0, 8)}`
  return `compartidos-pendientes/${params.userId}/${sello}_${safeName}`
}

/**
 * Construye la ruta (key) en R2 según el tipo de carpeta.
 * El sufijo aleatorio evita colisiones y hace las keys menos adivinables: la
 * key es la última barrera si una fila de BD llegara a manipularse.
 */
export function buildR2Key(params: {
  userId: string
  fileName: string
  scope: 'comun' | 'publico' | 'privado'
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const sello = `${Date.now()}_${randomUUID().slice(0, 8)}`
  switch (params.scope) {
    case 'comun':
      return `comun/${sello}_${safeName}`
    case 'publico':
      return `usuarios/${params.userId}/publico/${sello}_${safeName}`
    case 'privado':
      return `usuarios/${params.userId}/privado/${sello}_${safeName}`
  }
}
