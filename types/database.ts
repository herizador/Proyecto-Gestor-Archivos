// =============================================================================
// Tipos TypeScript generados del esquema de Supabase
// Para regenerar automáticamente: npx supabase gen types typescript --project-id <id>
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      perfiles: {
        Row: {
          id: string
          nombre_completo: string
          rol: 'admin' | 'miembro'
          avatar_url: string | null
          fecha_registro: string
        }
        Insert: {
          id: string
          nombre_completo?: string
          rol?: 'admin' | 'miembro'
          avatar_url?: string | null
          fecha_registro?: string
        }
        Update: {
          id?: string
          nombre_completo?: string
          rol?: 'admin' | 'miembro'
          avatar_url?: string | null
          fecha_registro?: string
        }
        Relationships: []
      }
      carpetas: {
        Row: {
          id: string
          nombre: string
          creado_por: string
          es_privada: boolean
          carpeta_padre_id: string | null
          fecha_creacion: string
        }
        Insert: {
          id?: string
          nombre: string
          creado_por: string
          es_privada?: boolean
          carpeta_padre_id?: string | null
          fecha_creacion?: string
        }
        Update: {
          id?: string
          nombre?: string
          creado_por?: string
          es_privada?: boolean
          carpeta_padre_id?: string | null
          fecha_creacion?: string
        }
        Relationships: [
          {
            foreignKeyName: 'carpetas_creado_por_fkey'
            columns: ['creado_por']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'carpetas_carpeta_padre_id_fkey'
            columns: ['carpeta_padre_id']
            isOneToOne: false
            referencedRelation: 'carpetas'
            referencedColumns: ['id']
          },
        ]
      }
      archivos: {
        Row: {
          id: string
          nombre_original: string
          ruta_r2: string
          tamano_bytes: number
          tipo_mime: string
          carpeta_id: string | null
          subido_por: string
          estado: 'activo' | 'papelera'
          fecha_subida: string
          fecha_papelera: string | null
        }
        Insert: {
          id?: string
          nombre_original: string
          ruta_r2: string
          tamano_bytes?: number
          tipo_mime?: string
          carpeta_id?: string | null
          subido_por: string
          estado?: 'activo' | 'papelera'
          fecha_subida?: string
          fecha_papelera?: string | null
        }
        Update: {
          id?: string
          nombre_original?: string
          ruta_r2?: string
          tamano_bytes?: number
          tipo_mime?: string
          carpeta_id?: string | null
          subido_por?: string
          estado?: 'activo' | 'papelera'
          fecha_subida?: string
          fecha_papelera?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'archivos_carpeta_id_fkey'
            columns: ['carpeta_id']
            isOneToOne: false
            referencedRelation: 'carpetas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'archivos_subido_por_fkey'
            columns: ['subido_por']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
      historial_actividad: {
        Row: {
          id: string
          usuario_id: string | null
          accion: ActivityAction
          detalles: Json | null
          fecha_evento: string
        }
        Insert: {
          id?: string
          usuario_id?: string | null
          accion: ActivityAction
          detalles?: Json | null
          fecha_evento?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'historial_actividad_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
      enlaces_compartidos: {
        Row: {
          id: string
          creado_por: string
          tipo_recurso: string
          archivos_ids: string
          carpetas_ids: string
          token_acceso: string
          expiracion: string | null
          fecha_creacion: string
        }
        Insert: {
          id?: string
          creado_por: string
          tipo_recurso?: string
          archivos_ids?: string
          carpetas_ids?: string
          token_acceso: string
          expiracion?: string | null
          fecha_creacion?: string
        }
        Update: {
          id?: string
          creado_por?: string
          tipo_recurso?: string
          archivos_ids?: string
          carpetas_ids?: string
          token_acceso?: string
          expiracion?: string | null
          fecha_creacion?: string
        }
        Relationships: [
          {
            foreignKeyName: 'enlaces_compartidos_creado_por_fkey'
            columns: ['creado_por']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
      lotes_recibidos: {
        Row: {
          id: string
          usuario_id: string
          claves_r2: Json
          metadatos: Json
          fecha_creacion: string
        }
        Insert: {
          id?: string
          usuario_id: string
          claves_r2: Json
          metadatos?: Json
          fecha_creacion?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'lotes_recibidos_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
      accesos_directos: {
        Row: {
          id: string
          creado_por: string
          carpeta_contenedora_id: string
          archivo_objetivo_id: string | null
          carpeta_objetivo_id: string | null
          nombre_personalizado: string | null
          fecha_creacion: string
        }
        Insert: {
          id?: string
          creado_por: string
          carpeta_contenedora_id: string
          archivo_objetivo_id?: string | null
          carpeta_objetivo_id?: string | null
          nombre_personalizado?: string | null
          fecha_creacion?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'accesos_directos_creado_por_fkey'
            columns: ['creado_por']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
      tokens_dav: {
        Row: {
          id: string
          usuario_id: string
          nombre: string
          token_hash: string
          revocado: boolean
          ultimo_uso: string | null
          fecha_creacion: string
        }
        Insert: {
          id?: string
          usuario_id: string
          nombre: string
          token_hash: string
          revocado?: boolean
          ultimo_uso?: string | null
          fecha_creacion?: string
        }
        Update: {
          id?: string
          usuario_id?: string
          nombre?: string
          token_hash?: string
          revocado?: boolean
          ultimo_uso?: string | null
          fecha_creacion?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tokens_dav_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'perfiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      get_storage_usage: {
        Args: Record<string, never>
        Returns: number
      }
      get_user_role: {
        Args: Record<string, never>
        Returns: 'admin' | 'miembro'
      }
    }
  }
}

// Acciones posibles en el historial
export type ActivityAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'SUBIR_ARCHIVO'
  | 'VISUALIZAR_ARCHIVO'
  | 'DESCARGAR_ARCHIVO'
  | 'MOVER_A_PAPELERA'
  | 'ELIMINAR_PERMANENTE'
  | 'RESTAURAR'
  | 'MOVER'
  | 'CAMBIAR_PRIVACIDAD'
  | 'CREAR_CARPETA'
  | 'ELIMINAR_CARPETA'
  | 'COMPARTIR_ENLACE'
  | 'CREAR_ACCESO'
  | 'ELIMINAR_ACCESO'
  | 'COMPARTIR_EXTERNO'
  | 'ACCESO_WEBDAV'
  | 'RENOMBRAR_ARCHIVO'
  | 'RENOMBRAR_CARPETA'

// Tipos de fila convenientes
export type Perfil = Database['public']['Tables']['perfiles']['Row']
export type Carpeta = Database['public']['Tables']['carpetas']['Row']
export type Archivo = Database['public']['Tables']['archivos']['Row']
export type HistorialActividad = Database['public']['Tables']['historial_actividad']['Row']

// Tipo extendido con JOIN de perfiles para el historial
export type HistorialConPerfil = HistorialActividad & {
  perfiles: Pick<Perfil, 'nombre_completo' | 'avatar_url'> | null
}

// Tipo extendido de archivo con el nombre del autor
export type ArchivoConAutor = Archivo & {
  subido_por_perfil: Pick<Perfil, 'nombre_completo'> | null
}

// Tipo para enlaces de compartición
export type EnlaceCompartido = Database['public']['Tables']['enlaces_compartidos']['Row']

// Acceso directo (enlace): un físico visible en N ubicaciones sin duplicar bytes
export type AccesoDirecto = Database['public']['Tables']['accesos_directos']['Row']

// Token de Explorador para el puente WebDAV (el claro solo existe al crearlo)
export type TokenDav = Database['public']['Tables']['tokens_dav']['Row']

// Acceso con su objetivo resuelto (LEFT JOIN: el objetivo puede ser NULL = huérfano)
export type AccesoConObjetivo = AccesoDirecto & {
  archivo_objetivo: (Pick<Archivo, 'id' | 'nombre_original' | 'tamano_bytes' | 'tipo_mime' | 'estado' | 'fecha_subida' | 'subido_por'> & {
    subido_por_perfil: Pick<Perfil, 'nombre_completo'> | null
    carpeta: Pick<Carpeta, 'id' | 'nombre'> | null
  }) | null
  carpeta_objetivo: (Pick<Carpeta, 'id' | 'nombre'> & {
    padre: Pick<Carpeta, 'id' | 'nombre'> | null
  }) | null
  carpeta_contenedora: Pick<Carpeta, 'id' | 'nombre'> | null
}

// Lote pendiente del Share Target: claves en staging + metadatos por fichero
export type LoteRecibido = Database['public']['Tables']['lotes_recibidos']['Row']

export type FicheroEnLote = {
  clave: string
  nombre: string
  tipo: string
  tamano: number
}
