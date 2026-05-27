/**
 * Normaliza URLs pre-firmadas S3/R2 para uso en navegador (window.open, <a href>).
 * Codifica cada segmento del pathname sin tocar el query string (firma X-Amz-*).
 */
export function toBrowserSafePresignedUrl(signedUrl: string): string {
  return signedUrl
}

/** Devuelve la URL lista para el navegador o null si no es absoluta (http/https). */
export function normalizePresignedUrlForBrowser(signedUrl: string): string | null {
  const trimmed = signedUrl.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return toBrowserSafePresignedUrl(trimmed)
  }
  if (trimmed.startsWith('//')) {
    return toBrowserSafePresignedUrl(`https:${trimmed}`)
  }
  return null
}
