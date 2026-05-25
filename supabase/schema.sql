-- =============================================================================
-- GESTOR DE ARCHIVOS FAMILIAR — Esquema de Base de Datos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================
-- INSTRUCCIONES:
--   1. Copia y pega TODO este contenido en el SQL Editor de Supabase.
--   2. Haz clic en "Run". Las tablas, políticas RLS y triggers se crearán solos.
--   3. No es necesario ejecutar nada más desde el dashboard.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- EXTENSIONES
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================================
-- TABLA 1: perfiles
-- Extiende auth.users de Supabase con datos propios de la familia.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.perfiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo TEXT      NOT NULL DEFAULT '',
  rol           TEXT        NOT NULL DEFAULT 'miembro' CHECK (rol IN ('admin', 'miembro')),
  avatar_url    TEXT,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: Crea automáticamente la fila en perfiles cuando alguien se registra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.perfiles (id, nombre_completo, rol)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'miembro')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- TABLA 2: carpetas
-- Árbol de organización con soporte de subcarpetas y control de privacidad.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.carpetas (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre           TEXT        NOT NULL,
  creado_por       UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  es_privada       BOOLEAN     NOT NULL DEFAULT FALSE,
  carpeta_padre_id UUID        REFERENCES public.carpetas(id) ON DELETE CASCADE,
  fecha_creacion   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para búsqueda eficiente del árbol
CREATE INDEX IF NOT EXISTS idx_carpetas_creado_por    ON public.carpetas(creado_por);
CREATE INDEX IF NOT EXISTS idx_carpetas_padre         ON public.carpetas(carpeta_padre_id);


-- =============================================================================
-- TABLA 3: archivos
-- Metadatos de los documentos. El archivo físico vive en Cloudflare R2.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.archivos (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre_original TEXT       NOT NULL,
  ruta_r2        TEXT        NOT NULL UNIQUE,  -- path único dentro del bucket R2
  tamano_bytes   BIGINT      NOT NULL DEFAULT 0,
  tipo_mime      TEXT        NOT NULL DEFAULT 'application/octet-stream',
  carpeta_id     UUID        REFERENCES public.carpetas(id) ON DELETE SET NULL,
  subido_por     UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  estado         TEXT        NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'papelera')),
  fecha_subida   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_papelera TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_archivos_carpeta_id  ON public.archivos(carpeta_id);
CREATE INDEX IF NOT EXISTS idx_archivos_subido_por  ON public.archivos(subido_por);
CREATE INDEX IF NOT EXISTS idx_archivos_estado      ON public.archivos(estado);


-- =============================================================================
-- TABLA 4: historial_actividad
-- Bitácora inmutable. Solo INSERT. Nunca UPDATE ni DELETE.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.historial_actividad (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id   UUID        REFERENCES public.perfiles(id) ON DELETE SET NULL,
  accion       TEXT        NOT NULL,  -- 'LOGIN', 'SUBIR_ARCHIVO', 'MOVER_A_PAPELERA', 'ELIMINAR_PERMANENTE', 'RESTAURAR', etc.
  detalles     JSONB,                 -- Datos extra: nombre del archivo, carpeta, IP, etc.
  fecha_evento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_usuario_id  ON public.historial_actividad(usuario_id);
CREATE INDEX IF NOT EXISTS idx_historial_accion       ON public.historial_actividad(accion);
CREATE INDEX IF NOT EXISTS idx_historial_fecha        ON public.historial_actividad(fecha_evento DESC);

-- Revocar UPDATE y DELETE en historial para garantizar inmutabilidad
REVOKE UPDATE, DELETE ON public.historial_actividad FROM authenticated;
REVOKE UPDATE, DELETE ON public.historial_actividad FROM anon;


-- =============================================================================
-- TRIGGER: Registro automático al subir un archivo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.registrar_subida_archivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.historial_actividad (usuario_id, accion, detalles)
  VALUES (
    NEW.subido_por,
    'SUBIR_ARCHIVO',
    jsonb_build_object(
      'archivo_id',       NEW.id,
      'nombre_original',  NEW.nombre_original,
      'carpeta_id',       NEW.carpeta_id,
      'tamano_bytes',     NEW.tamano_bytes
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_subida ON public.archivos;
CREATE TRIGGER trg_registrar_subida
  AFTER INSERT ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_subida_archivo();


-- =============================================================================
-- TRIGGER: Registro al mover a papelera o restaurar
-- =============================================================================
CREATE OR REPLACE FUNCTION public.registrar_cambio_estado_archivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.estado <> NEW.estado THEN
    INSERT INTO public.historial_actividad (usuario_id, accion, detalles)
    VALUES (
      NEW.subido_por,
      CASE
        WHEN NEW.estado = 'papelera' THEN 'MOVER_A_PAPELERA'
        WHEN NEW.estado = 'activo'   THEN 'RESTAURAR'
        ELSE 'CAMBIAR_ESTADO'
      END,
      jsonb_build_object(
        'archivo_id',      NEW.id,
        'nombre_original', NEW.nombre_original,
        'estado_anterior', OLD.estado,
        'estado_nuevo',    NEW.estado
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cambio_estado_archivo ON public.archivos;
CREATE TRIGGER trg_cambio_estado_archivo
  AFTER UPDATE OF estado ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_cambio_estado_archivo();


-- =============================================================================
-- TRIGGER: Bloqueo de almacenamiento al superar 9 GB
-- Límite: 9,663,676,416 bytes (9 GB exactos)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validar_limite_almacenamiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  total_actual BIGINT;
  limite_bytes BIGINT := 9663676416; -- 9 GB
BEGIN
  SELECT COALESCE(SUM(tamano_bytes), 0)
    INTO total_actual
    FROM public.archivos
   WHERE estado = 'activo';

  IF (total_actual + NEW.tamano_bytes) > limite_bytes THEN
    RAISE EXCEPTION 'LIMITE_ALMACENAMIENTO: El almacenamiento familiar ha alcanzado el límite de 9 GB. Contacta al administrador para liberar espacio.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_limite ON public.archivos;
CREATE TRIGGER trg_validar_limite
  BEFORE INSERT ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.validar_limite_almacenamiento();


-- =============================================================================
-- FUNCIÓN UTILITARIA: Consultar uso total de almacenamiento
-- Uso desde Next.js: supabase.rpc('get_storage_usage')
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_storage_usage()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(tamano_bytes), 0)
    FROM public.archivos
   WHERE estado = 'activo';
$$;


-- =============================================================================
-- ROW LEVEL SECURITY (RLS) — La última línea de defensa
-- =============================================================================

-- Función auxiliar: obtener rol del usuario autenticado
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT rol FROM public.perfiles WHERE id = auth.uid();
$$;

-- ─── RLS: perfiles ────────────────────────────────────────────────────────────
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfiles_select_propio" ON public.perfiles
  FOR SELECT USING (id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "perfiles_update_propio" ON public.perfiles
  FOR UPDATE USING (id = auth.uid());

-- ─── RLS: carpetas ────────────────────────────────────────────────────────────
ALTER TABLE public.carpetas ENABLE ROW LEVEL SECURITY;

-- Ver: carpetas públicas ó propias ó si es admin
CREATE POLICY "carpetas_select" ON public.carpetas
  FOR SELECT USING (
    es_privada = FALSE
    OR creado_por = auth.uid()
    OR public.get_user_role() = 'admin'
  );

-- Crear: cualquier usuario autenticado
CREATE POLICY "carpetas_insert" ON public.carpetas
  FOR INSERT WITH CHECK (creado_por = auth.uid());

-- Modificar: solo el creador o admin
CREATE POLICY "carpetas_update" ON public.carpetas
  FOR UPDATE USING (
    creado_por = auth.uid()
    OR public.get_user_role() = 'admin'
  );

-- Borrar: solo el creador o admin
CREATE POLICY "carpetas_delete" ON public.carpetas
  FOR DELETE USING (
    creado_por = auth.uid()
    OR public.get_user_role() = 'admin'
  );

-- ─── RLS: archivos ────────────────────────────────────────────────────────────
ALTER TABLE public.archivos ENABLE ROW LEVEL SECURITY;

-- Ver: archivo en carpeta pública ó propio ó admin
CREATE POLICY "archivos_select" ON public.archivos
  FOR SELECT USING (
    subido_por = auth.uid()
    OR public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.carpetas c
       WHERE c.id = archivos.carpeta_id
         AND c.es_privada = FALSE
    )
  );

-- Subir: cualquier usuario autenticado
CREATE POLICY "archivos_insert" ON public.archivos
  FOR INSERT WITH CHECK (subido_por = auth.uid());

-- Modificar: solo el dueño o admin
CREATE POLICY "archivos_update" ON public.archivos
  FOR UPDATE USING (
    subido_por = auth.uid()
    OR public.get_user_role() = 'admin'
  );

-- Borrar físicamente: solo admin (el borrado normal es cambio de estado)
CREATE POLICY "archivos_delete" ON public.archivos
  FOR DELETE USING (public.get_user_role() = 'admin');

-- ─── RLS: historial_actividad ─────────────────────────────────────────────────
ALTER TABLE public.historial_actividad ENABLE ROW LEVEL SECURITY;

-- Ver: solo admin
CREATE POLICY "historial_select_admin" ON public.historial_actividad
  FOR SELECT USING (public.get_user_role() = 'admin');

-- Insertar: solo el sistema vía triggers (SECURITY DEFINER)
CREATE POLICY "historial_insert_sistema" ON public.historial_actividad
  FOR INSERT WITH CHECK (TRUE);
