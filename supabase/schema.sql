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
-- TABLA 5: enlaces_compartidos
-- Almacena enlaces de compartición con token único y expiración.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.enlaces_compartidos (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  creado_por         UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  tipo_recurso       TEXT        NOT NULL DEFAULT 'multiple',
  archivos_ids       TEXT        NOT NULL DEFAULT '[]',
  carpetas_ids       TEXT        NOT NULL DEFAULT '[]',
  token_acceso       TEXT        NOT NULL UNIQUE,
  expiracion         TIMESTAMPTZ,
  fecha_creacion     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enlaces_token ON public.enlaces_compartidos(token_acceso);

-- RLS: enlaces_compartidos
ALTER TABLE public.enlaces_compartidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enlaces_select_token" ON public.enlaces_compartidos
  FOR SELECT USING (TRUE); -- cualquiera con el token puede consultar

CREATE POLICY "enlaces_insert_propio" ON public.enlaces_compartidos
  FOR INSERT WITH CHECK (creado_por = auth.uid());

CREATE POLICY "enlaces_delete_propio" ON public.enlaces_compartidos
  FOR DELETE USING (creado_por = auth.uid() OR public.get_user_role() = 'admin');


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

-- Directorio familiar (Compartido conmigo): todo autenticado ve id + nombre del
-- resto para poder cederles. Solo expone el directorio, no más columnas.
CREATE POLICY "perfiles_select_directorio" ON public.perfiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "perfiles_update_propio" ON public.perfiles
  FOR UPDATE USING (id = auth.uid());

-- ─── RLS: carpetas ────────────────────────────────────────────────────────────
ALTER TABLE public.carpetas ENABLE ROW LEVEL SECURITY;

-- Ver: pública, propia, compartida conmigo o con un ancestro visible (herencia).
-- Sin bypass de admin: «Mi caja fuerte» es privada también para el administrador.
CREATE POLICY "carpetas_select" ON public.carpetas
  FOR SELECT USING (
    public.carpeta_visible_para(auth.uid(), carpetas.id)
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

-- Color de carpeta (Figma en oscuro, 2026-10): rellena las existentes con índigo
ALTER TABLE public.carpetas ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'indigo';

-- Favoritos por usuario (Fase 2 Figma): un favorito apunta a un archivo O a
-- una carpeta (nunca ambos). Los duplicados se impiden con índices únicos.
CREATE TABLE IF NOT EXISTS public.favoritos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  archivo_id  UUID REFERENCES public.archivos(id) ON DELETE CASCADE,
  carpeta_id  UUID REFERENCES public.carpetas(id) ON DELETE CASCADE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_favorito_un_objetivo CHECK (
    (archivo_id IS NOT NULL AND carpeta_id IS NULL) OR
    (archivo_id IS NULL AND carpeta_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_favorito_archivo
  ON public.favoritos(usuario_id, archivo_id) WHERE archivo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_favorito_carpeta
  ON public.favoritos(usuario_id, carpeta_id) WHERE carpeta_id IS NOT NULL;

ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favoritos_propio" ON public.favoritos
  FOR ALL USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- =============================================================================
-- TABLA: compartidos (cesiones nominales entre miembros)
-- Ver docs/diseno/compartidos.md. La visibilidad con herencia vive en
-- carpeta_visible_para(), usada por carpetas_select y archivos_select.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.compartidos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creado_por     UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  compartido_con UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  archivo_id     UUID REFERENCES public.archivos(id) ON DELETE CASCADE,
  carpeta_id     UUID REFERENCES public.carpetas(id) ON DELETE CASCADE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_compartido_un_recurso CHECK (
    (archivo_id IS NOT NULL AND carpeta_id IS NULL) OR
    (archivo_id IS NULL AND carpeta_id IS NOT NULL)
  ),
  CONSTRAINT chk_no_autocompartir CHECK (creado_por <> compartido_con)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_compartido_archivo
  ON public.compartidos(compartido_con, archivo_id) WHERE archivo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_compartido_carpeta
  ON public.compartidos(compartido_con, carpeta_id) WHERE carpeta_id IS NOT NULL;

ALTER TABLE public.compartidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compartidos_select" ON public.compartidos;
CREATE POLICY "compartidos_select" ON public.compartidos
  FOR SELECT USING (compartido_con = auth.uid() OR public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "compartidos_insert" ON public.compartidos;
CREATE POLICY "compartidos_insert" ON public.compartidos
  FOR INSERT WITH CHECK (creado_por = auth.uid());

DROP POLICY IF EXISTS "compartidos_delete" ON public.compartidos;
CREATE POLICY "compartidos_delete" ON public.compartidos
  FOR DELETE USING (creado_por = auth.uid() OR compartido_con = auth.uid() OR public.get_user_role() = 'admin');

-- ¿Puede uid ver esta carpeta? Ella o algún ancestro es propio, público o
-- compartido con él. Tope de 50 niveles (anti-ciclos heredados).
CREATE OR REPLACE FUNCTION public.carpeta_visible_para(p_uid UUID, p_carpeta UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE cadena AS (
    SELECT c.id, c.carpeta_padre_id, c.es_privada, c.creado_por, 1 AS nivel
      FROM public.carpetas c WHERE c.id = p_carpeta
    UNION ALL
    SELECT p.id, p.carpeta_padre_id, p.es_privada, p.creado_por, h.nivel + 1
      FROM public.carpetas p
      JOIN cadena h ON p.id = h.carpeta_padre_id
     WHERE h.nivel < 50
  )
  SELECT EXISTS (
    SELECT 1 FROM cadena
     WHERE creado_por = p_uid
        OR es_privada = FALSE
        OR EXISTS (
          SELECT 1 FROM public.compartidos co
           WHERE co.carpeta_id = cadena.id
             AND co.compartido_con = p_uid
        )
  );
$$;

-- ─── RLS: archivos ────────────────────────────────────────────────────────────
ALTER TABLE public.archivos ENABLE ROW LEVEL SECURITY;

-- Ver: propio, compartido, en carpeta visible (pública/propia/compartida) o en
-- la raíz del Área común. Sin bypass de admin: la Caja fuerte es privada.
CREATE POLICY "archivos_select" ON public.archivos
  FOR SELECT USING (
    subido_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.compartidos co
       WHERE co.archivo_id = archivos.id
         AND co.compartido_con = auth.uid()
    )
    OR (
      archivos.carpeta_id IS NOT NULL
      AND public.carpeta_visible_para(auth.uid(), archivos.carpeta_id)
    )
    OR (
      archivos.carpeta_id IS NULL
      AND archivos.ruta_r2 NOT LIKE '%/privado/%'
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

-- Ver: cada miembro ve sus propias filas (la actividad ajena sigue vetada)
CREATE POLICY "historial_select_propio" ON public.historial_actividad
  FOR SELECT USING (usuario_id = auth.uid());

-- Insertar: solo el sistema vía triggers (SECURITY DEFINER)
CREATE POLICY "historial_insert_sistema" ON public.historial_actividad
  FOR INSERT WITH CHECK (TRUE);


-- =============================================================================
-- TABLA 6: lotes_recibidos
-- Staging del Web Share Target: el POST de /api/recibir sube aquí los
-- ficheros y la página /recibir los mueve a su destino definitivo.
-- Sin UPDATE: los lotes se confirman y se borran, no se editan.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.lotes_recibidos (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id     UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  claves_r2      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadatos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lotes_recibidos_usuario ON public.lotes_recibidos(usuario_id);

-- ─── RLS: lotes_recibidos ─────────────────────────────────────────────────────
ALTER TABLE public.lotes_recibidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lotes_select_propio" ON public.lotes_recibidos
  FOR SELECT USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "lotes_insert_propio" ON public.lotes_recibidos
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "lotes_delete_propio_admin" ON public.lotes_recibidos
  FOR DELETE USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin');


-- =============================================================================
-- TABLA 7: accesos_directos
-- Un fichero físico visible en N ubicaciones sin duplicar bytes (no suma cupo).
-- Ambos objetivos a NULL = enlace huérfano (el original se borró o está en
-- papelera); por eso el CHECK solo prohíbe apuntar a archivo Y carpeta a la vez.
-- Sin UPDATE: los enlaces no se editan, se borran y se recrean.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.accesos_directos (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creado_por             UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  carpeta_contenedora_id UUID NOT NULL REFERENCES public.carpetas(id) ON DELETE CASCADE,
  archivo_objetivo_id    UUID REFERENCES public.archivos(id) ON DELETE SET NULL,
  carpeta_objetivo_id    UUID REFERENCES public.carpetas(id) ON DELETE SET NULL,
  nombre_personalizado   TEXT,
  fecha_creacion         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_un_solo_objetivo CHECK (
    NOT (archivo_objetivo_id IS NOT NULL AND carpeta_objetivo_id IS NOT NULL)
  )
);

-- Deduplicación real (una UNIQUE multidominio no funciona con NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS uq_acceso_archivo
  ON public.accesos_directos(carpeta_contenedora_id, archivo_objetivo_id)
  WHERE archivo_objetivo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_acceso_carpeta
  ON public.accesos_directos(carpeta_contenedora_id, carpeta_objetivo_id)
  WHERE carpeta_objetivo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accesos_contenedora
  ON public.accesos_directos(carpeta_contenedora_id);

-- ─── RLS: accesos_directos ────────────────────────────────────────────────────
ALTER TABLE public.accesos_directos ENABLE ROW LEVEL SECURITY;

-- Ver: creador, admin, con acceso al objetivo, o (huérfano) a la contenedora
CREATE POLICY "accesos_select" ON public.accesos_directos
  FOR SELECT USING (
    creado_por = auth.uid()
    OR public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.archivos a
      WHERE a.id = accesos_directos.archivo_objetivo_id
        AND (
          a.subido_por = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.carpetas c
            WHERE c.id = a.carpeta_id AND c.es_privada = FALSE
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.carpetas c
      WHERE c.id = accesos_directos.carpeta_objetivo_id
        AND (c.creado_por = auth.uid() OR c.es_privada = FALSE)
    )
    OR (
      accesos_directos.archivo_objetivo_id IS NULL
      AND accesos_directos.carpeta_objetivo_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.carpetas c
        WHERE c.id = accesos_directos.carpeta_contenedora_id
          AND (c.creado_por = auth.uid() OR c.es_privada = FALSE)
      )
    )
  );

CREATE POLICY "accesos_insert_propio" ON public.accesos_directos
  FOR INSERT WITH CHECK (creado_por = auth.uid());

CREATE POLICY "accesos_delete_propio_admin" ON public.accesos_directos
  FOR DELETE USING (creado_por = auth.uid() OR public.get_user_role() = 'admin');


-- =============================================================================
-- TABLA 8: tokens_dav
-- Contraseñas de Explorador para el puente WebDAV (un token = un dispositivo).
-- El token en claro solo existe al crearlo; en BD solo vive su hash SHA-256.
-- La PWA gestiona tokens propios vía RLS; el Worker usa service-role.
-- Sin UPDATE salvo revocar: los tokens no se editan.
-- Ver docs/diseno/webdav.md
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tokens_dav (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id     UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  nombre         TEXT        NOT NULL,
  token_hash     TEXT        NOT NULL UNIQUE,
  revocado       BOOLEAN     NOT NULL DEFAULT FALSE,
  ultimo_uso     TIMESTAMPTZ,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_dav_usuario ON public.tokens_dav(usuario_id);

-- ─── RLS: tokens_dav ────────────────────────────────────────────────────────
ALTER TABLE public.tokens_dav ENABLE ROW LEVEL SECURITY;

-- Ver: propios o admin (el admin audita los de todos)
CREATE POLICY "tokens_dav_select" ON public.tokens_dav
  FOR SELECT USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin');

-- Crear: solo propios (el usuario_id lo fija la server action, nunca el cliente)
CREATE POLICY "tokens_dav_insert" ON public.tokens_dav
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- Revocar: propios o admin
CREATE POLICY "tokens_dav_update" ON public.tokens_dav
  FOR UPDATE USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin');

-- Borrar: propios o admin
CREATE POLICY "tokens_dav_delete" ON public.tokens_dav
  FOR DELETE USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin');


-- =============================================================================
-- TABLA: locks_dav (Fase C de escritura WebDAV: LOCK/UNLOCK)
-- Bloqueos exclusivos de escritura para que Office abra en edición.
-- Solo la usa el Worker con service-role; RLS sin policies = denegado a la PWA.
-- Caducan solos y se limpian de forma oportunista en cada LOCK/UNLOCK.
-- Ver supabase/migraciones/locks-dav.sql y docs/diseno/webdav-escritura.md §6.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.locks_dav (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  recurso_id      UUID        NOT NULL,
  es_carpeta      BOOLEAN     NOT NULL DEFAULT FALSE,
  profundidad     TEXT        NOT NULL DEFAULT 'infinity'
                              CHECK (profundidad IN ('0', 'infinity')),
  usuario_id      UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  propietario     TEXT        NOT NULL,
  token           TEXT        NOT NULL UNIQUE,
  expira          TIMESTAMPTZ NOT NULL,
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_locks_dav_recurso
  ON public.locks_dav(recurso_id);

CREATE INDEX IF NOT EXISTS idx_locks_dav_expira
  ON public.locks_dav(expira);

ALTER TABLE public.locks_dav ENABLE ROW LEVEL SECURITY;

-- Sin policies: la PWA no lee ni escribe bloqueos. El Worker usa service-role.


-- =============================================================================
-- TABLA: recordatorios (avisos de vencimiento por usuario; nunca borran nada)
-- Ver supabase/migraciones/recordatorios.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.recordatorios (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id     UUID NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  detalle        TEXT,
  vence_el       DATE NOT NULL,
  archivo_id     UUID REFERENCES public.archivos(id) ON DELETE CASCADE,
  carpeta_id     UUID REFERENCES public.carpetas(id) ON DELETE CASCADE,
  completado     BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_recordatorio_un_recurso CHECK (
    (archivo_id IS NULL AND carpeta_id IS NULL) OR
    (archivo_id IS NOT NULL AND carpeta_id IS NULL) OR
    (archivo_id IS NULL AND carpeta_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario
  ON public.recordatorios(usuario_id, vence_el) WHERE completado = FALSE;

ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recordatorios_propio" ON public.recordatorios;
CREATE POLICY "recordatorios_propio" ON public.recordatorios
  FOR ALL USING (usuario_id = auth.uid() OR public.get_user_role() = 'admin')
  WITH CHECK (usuario_id = auth.uid() OR public.get_user_role() = 'admin');


-- =============================================================================
-- TABLA 9: invitaciones_pendientes
-- Reclamos de invitación de un solo uso (30 min): el enlace del email autoriza
-- ÚNICAMENTE a definir la contraseña, nunca a navegar con sesión. Solo la usa
-- el servidor con service-role (RLS activado sin policies = denegado a resto).
-- Ver docs/guias/invitaciones.md
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invitaciones_pendientes (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id     UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  token_hash     TEXT        NOT NULL UNIQUE,
  usada          BOOLEAN     NOT NULL DEFAULT FALSE,
  expira         TIMESTAMPTZ NOT NULL,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_pendientes_usuario ON public.invitaciones_pendientes(usuario_id);

ALTER TABLE public.invitaciones_pendientes ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo service-role (el navegador nunca la toca directo).
