import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { toBrowserSafePresignedUrl } from '@/lib/presigned-url'

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
  return fileName.replace(/["\\]/g, '_')
}

/**
 * Genera una URL pre-firmada para VISUALIZAR en el navegador (inline).
 */
export async function getPresignedViewUrl(key: string, expiresIn = 900): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: 'inline',
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
  expiresIn = 300
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return presignAndNormalize(command, expiresIn)
}

/**
 * Elimina un objeto de R2 definitivamente. Solo llamar tras confirmar en BD.
 */
export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  await r2Client.send(command)
}

/**
 * Construye la ruta (key) en R2 según el tipo de carpeta.
 */
export function buildR2Key(params: {
  userId: string
  fileName: string
  scope: 'comun' | 'publico' | 'privado'
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const timestamp = Date.now()
  switch (params.scope) {
    case 'comun':
      return `comun/${timestamp}_${safeName}`
    case 'publico':
      return `usuarios/${params.userId}/publico/${timestamp}_${safeName}`
    case 'privado':
      return `usuarios/${params.userId}/privado/${timestamp}_${safeName}`
  }
}
