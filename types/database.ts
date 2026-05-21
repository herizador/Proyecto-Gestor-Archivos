// =============================================================================
// Tipos TypeScript generados del esquema de Supabase
// Para regenerar automáticamente: npx supabase gen types typescript --project-id <id>
// =============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
        Update: never // La bitácora es inmutable
      }
    }
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
  | 'DESCARGAR_ARCHIVO'
  | 'ELIMINAR'
  | 'RESTAURAR'
  | 'MOVER'
  | 'CAMBIAR_PRIVACIDAD'
  | 'CREAR_CARPETA'
  | 'ELIMINAR_CARPETA'

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
