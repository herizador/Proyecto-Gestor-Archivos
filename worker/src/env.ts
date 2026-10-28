// Tipos y constantes compartidos por el puente WebDAV.
// La escritura se controla con DAV_WRITE: "0" (apagada), "admin" o "all".

export interface Env {
  BUCKET: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  DAV_WRITE?: string
}

export type FilaCarpeta = {
  id: string
  nombre: string
  carpeta_padre_id: string | null
  es_privada: boolean
  creado_por: string
  fecha_creacion: string
}

export type FilaArchivo = {
  id: string
  nombre_original: string
  ruta_r2: string
  tamano_bytes: number
  tipo_mime: string
  fecha_subida: string
  carpeta_id: string | null
  subido_por: string
}

export type UsuarioDav = { id: string; rol: string; tokenId: string }
export type Scope = 'comun' | 'privado'

export const RAIZ_COMUN = 'Área común'
export const RAIZ_PRIVADA = 'Mi caja fuerte'

// Mismo límite que el trigger validar_limite_almacenamiento de la BD
export const LIMITE_BYTES = 9663676416 // 9 GB

// Mismo límite que getUploadUrl() en la PWA
export const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

// Profundidad máxima de ruta (anti-abuso: cada nivel es una consulta)
export const MAX_SEGMENTOS = 25

export const SELECT_CARPETA = 'id,nombre,carpeta_padre_id,es_privada,creado_por,fecha_creacion'
export const SELECT_ARCHIVO =
  'id,nombre_original,ruta_r2,tamano_bytes,tipo_mime,fecha_subida,carpeta_id,subido_por'
