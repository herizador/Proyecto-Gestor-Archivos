-- =============================================================================
-- MIGRACIÓN: endurecimiento de seguridad de archivos (2026-11)
-- Pegar entero en Supabase → SQL Editor → Run. Es idempotente.
--
-- Corrige, en la capa de base de datos:
--   · enlaces_compartidos: cualquiera podía listar todos los tokens (USING TRUE)
--   · archivos: se podían insertar filas apuntando a keys R2 ajenas
--   · archivos/carpetas: el admin podía modificar/borrar contenido privado ajeno
--   · archivos_delete: el dueño no podía borrar definitivamente su archivo
--   · historial_actividad: cualquier usuario podía insertar auditoría falsa
--   · lotes_recibidos: claves R2 arbitrarias (borrado/movido de objetos ajenos)
--   · compartidos: se podía ceder un recurso privado ajeno
--   · funciones SECURITY DEFINER sin search_path fijo
--
-- Este mismo cambio está reflejado en supabase/schema.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Funciones auxiliares con search_path fijo (evita hijacking de esquema)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM public.perfiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_storage_usage()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(tamano_bytes), 0)
    FROM public.archivos
   WHERE estado = 'activo';
$$;

-- -----------------------------------------------------------------------------
-- 2. Auditoría inmutable: solo triggers y esta RPC pueden insertar
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_actividad(
  p_accion TEXT,
  p_detalles JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_accion IS NULL OR btrim(p_accion) = '' OR length(p_accion) > 60 THEN
    RAISE EXCEPTION 'Acción de auditoría no válida';
  END IF;
  IF p_detalles IS NOT NULL AND pg_column_size(p_detalles) > 65536 THEN
    RAISE EXCEPTION 'Detalles de auditoría demasiado grandes';
  END IF;

  INSERT INTO public.historial_actividad (usuario_id, accion, detalles)
  VALUES (auth.uid(), p_accion, p_detalles);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_actividad(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_actividad(TEXT, JSONB) TO authenticated;

DROP POLICY IF EXISTS "historial_insert_sistema" ON public.historial_actividad;
-- Los triggers SECURITY DEFINER y service-role siguen insertando; el navegador
-- ya no puede escribir filas de auditoría directamente.
REVOKE INSERT ON public.historial_actividad FROM authenticated;
REVOKE INSERT ON public.historial_actividad FROM anon;

-- -----------------------------------------------------------------------------
-- 3. Integridad de las rutas R2 de `archivos`
-- -----------------------------------------------------------------------------
ALTER TABLE public.archivos DROP CONSTRAINT IF EXISTS chk_archivos_ruta_r2;
ALTER TABLE public.archivos
  ADD CONSTRAINT chk_archivos_ruta_r2 CHECK (
    (
      ruta_r2 ~ '^comun/[A-Za-z0-9._-]+$'
      OR ruta_r2 ~ '^usuarios/[0-9a-fA-F-]{36}/(publico|privado)/[A-Za-z0-9._-]+$'
    )
    AND ruta_r2 !~ '(^|/)\.\.?(/|$)'
  ) NOT VALID;

-- La autoría de una fila no se puede transferir con un UPDATE.
CREATE OR REPLACE FUNCTION public.proteger_autoria_archivos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subido_por IS DISTINCT FROM OLD.subido_por THEN
    RAISE EXCEPTION 'No se puede cambiar el autor de un archivo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_autoria_archivos ON public.archivos;
CREATE TRIGGER trg_proteger_autoria_archivos
  BEFORE UPDATE OF subido_por ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_autoria_archivos();

CREATE OR REPLACE FUNCTION public.proteger_autoria_carpetas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
    RAISE EXCEPTION 'No se puede cambiar el autor de una carpeta';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_autoria_carpetas ON public.carpetas;
CREATE TRIGGER trg_proteger_autoria_carpetas
  BEFORE UPDATE OF creado_por ON public.carpetas
  FOR EACH ROW EXECUTE FUNCTION public.proteger_autoria_carpetas();

-- -----------------------------------------------------------------------------
-- 4. RLS: archivos
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "archivos_insert" ON public.archivos;
CREATE POLICY "archivos_insert" ON public.archivos
  FOR INSERT WITH CHECK (
    subido_por = auth.uid()
    AND ruta_r2 !~ '(^|/)\.\.?(/|$)'
    AND (
      ruta_r2 ~ '^comun/[^/]+$'
      OR ruta_r2 ~ ('^usuarios/' || auth.uid()::text || '/(publico|privado)/[^/]+$')
    )
    AND (
      carpeta_id IS NULL
      OR (
        public.carpeta_visible_para(auth.uid(), carpeta_id)
        AND (ruta_r2 LIKE '%/privado/%') = COALESCE(
          (SELECT c.es_privada FROM public.carpetas c WHERE c.id = archivos.carpeta_id),
          TRUE
        )
      )
    )
  );

DROP POLICY IF EXISTS "archivos_update" ON public.archivos;
CREATE POLICY "archivos_update" ON public.archivos
  FOR UPDATE
  USING (
    subido_por = auth.uid()
    OR (public.get_user_role() = 'admin' AND ruta_r2 NOT LIKE '%/privado/%')
  )
  WITH CHECK (
    (
      subido_por = auth.uid()
      AND ruta_r2 !~ '(^|/)\.\.?(/|$)'
      AND (
        ruta_r2 ~ '^comun/[^/]+$'
        OR ruta_r2 ~ ('^usuarios/' || auth.uid()::text || '/(publico|privado)/[^/]+$')
      )
    )
    OR (
      public.get_user_role() = 'admin'
      AND ruta_r2 NOT LIKE '%/privado/%'
    )
  );

DROP POLICY IF EXISTS "archivos_delete" ON public.archivos;
CREATE POLICY "archivos_delete" ON public.archivos
  FOR DELETE USING (
    subido_por = auth.uid()
    OR (public.get_user_role() = 'admin' AND ruta_r2 NOT LIKE '%/privado/%')
  );

-- -----------------------------------------------------------------------------
-- 5. RLS: carpetas (sin bypass de admin sobre carpetas privadas)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "carpetas_insert" ON public.carpetas;
CREATE POLICY "carpetas_insert" ON public.carpetas
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      carpeta_padre_id IS NULL
      OR public.carpeta_visible_para(auth.uid(), carpeta_padre_id)
    )
  );

DROP POLICY IF EXISTS "carpetas_update" ON public.carpetas;
CREATE POLICY "carpetas_update" ON public.carpetas
  FOR UPDATE
  USING (
    creado_por = auth.uid()
    OR (public.get_user_role() = 'admin' AND es_privada = FALSE)
  )
  WITH CHECK (
    creado_por = auth.uid()
    OR (public.get_user_role() = 'admin' AND es_privada = FALSE)
  );

DROP POLICY IF EXISTS "carpetas_delete" ON public.carpetas;
CREATE POLICY "carpetas_delete" ON public.carpetas
  FOR DELETE USING (
    creado_por = auth.uid()
    OR (public.get_user_role() = 'admin' AND es_privada = FALSE)
  );

-- -----------------------------------------------------------------------------
-- 6. RLS: enlaces_compartidos (el token ya no se puede listar desde el cliente)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "enlaces_select_token" ON public.enlaces_compartidos;
DROP POLICY IF EXISTS "enlaces_select_propio" ON public.enlaces_compartidos;
CREATE POLICY "enlaces_select_propio" ON public.enlaces_compartidos
  FOR SELECT USING (creado_por = auth.uid());

-- -----------------------------------------------------------------------------
-- 7. RLS: compartidos (no se puede ceder lo privado ajeno)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "compartidos_insert" ON public.compartidos;
CREATE POLICY "compartidos_insert" ON public.compartidos
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND compartido_con <> auth.uid()
    AND (
      (
        archivo_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.archivos a
           WHERE a.id = compartidos.archivo_id
             AND (a.subido_por = auth.uid() OR a.ruta_r2 NOT LIKE '%/privado/%')
        )
      )
      OR (
        carpeta_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.carpetas c
           WHERE c.id = compartidos.carpeta_id
             AND (c.creado_por = auth.uid() OR c.es_privada = FALSE)
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 7b. RLS: accesos_directos (no publicar privado ni escribir en privado ajeno)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "accesos_insert_propio" ON public.accesos_directos;
CREATE POLICY "accesos_insert_propio" ON public.accesos_directos
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.carpetas cont
       WHERE cont.id = accesos_directos.carpeta_contenedora_id
         AND public.carpeta_visible_para(auth.uid(), cont.id)
         AND (cont.es_privada = FALSE OR cont.creado_por = auth.uid())
    )
    AND (
      accesos_directos.archivo_objetivo_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.archivos a
         WHERE a.id = accesos_directos.archivo_objetivo_id
           AND (
             a.ruta_r2 NOT LIKE '%/privado/%'
             OR EXISTS (
               SELECT 1 FROM public.carpetas cont
                WHERE cont.id = accesos_directos.carpeta_contenedora_id
                  AND cont.es_privada AND cont.creado_por = auth.uid()
             )
           )
      )
    )
    AND (
      accesos_directos.carpeta_objetivo_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.carpetas obj
         WHERE obj.id = accesos_directos.carpeta_objetivo_id
           AND (
             obj.es_privada = FALSE
             OR EXISTS (
               SELECT 1 FROM public.carpetas cont
                WHERE cont.id = accesos_directos.carpeta_contenedora_id
                  AND cont.es_privada AND cont.creado_por = auth.uid()
             )
           )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 8. RLS: lotes_recibidos (staging privado y claves auditables)
-- -----------------------------------------------------------------------------DROP POLICY IF EXISTS "lotes_select_propio" ON public.lotes_recibidos;
CREATE POLICY "lotes_select_propio" ON public.lotes_recibidos
  FOR SELECT USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS "lotes_delete_propio_admin" ON public.lotes_recibidos;
DROP POLICY IF EXISTS "lotes_delete_propio" ON public.lotes_recibidos;
CREATE POLICY "lotes_delete_propio" ON public.lotes_recibidos
  FOR DELETE USING (usuario_id = auth.uid());

CREATE OR REPLACE FUNCTION public.validar_lote_recibido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clave TEXT;
  meta  JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'LOTE_INVALIDO: usuario incorrecto';
  END IF;
  IF jsonb_typeof(NEW.claves_r2) <> 'array' THEN
    RAISE EXCEPTION 'LOTE_INVALIDO: claves_r2 debe ser un array';
  END IF;
  IF jsonb_array_length(NEW.claves_r2) > 10 THEN
    RAISE EXCEPTION 'LOTE_INVALIDO: demasiados archivos';
  END IF;

  FOR clave IN SELECT jsonb_array_elements_text(NEW.claves_r2) LOOP
    IF clave !~ ('^compartidos-pendientes/' || NEW.usuario_id::text || '/[A-Za-z0-9._-]+$') THEN
      RAISE EXCEPTION 'LOTE_INVALIDO: clave fuera del staging del usuario';
    END IF;
  END LOOP;

  IF jsonb_typeof(NEW.metadatos) = 'array' THEN
    FOR meta IN SELECT * FROM jsonb_array_elements(NEW.metadatos) LOOP
      clave := meta->>'clave';
      IF clave IS NULL
         OR clave !~ ('^compartidos-pendientes/' || NEW.usuario_id::text || '/[A-Za-z0-9._-]+$') THEN
        RAISE EXCEPTION 'LOTE_INVALIDO: metadatos con clave no válida';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_lote_recibido ON public.lotes_recibidos;
CREATE TRIGGER trg_validar_lote_recibido
  BEFORE INSERT ON public.lotes_recibidos
  FOR EACH ROW EXECUTE FUNCTION public.validar_lote_recibido();

-- -----------------------------------------------------------------------------
-- 9. Herencia de privacidad en carpetas
-- Una carpeta dentro de una carpeta privada es siempre privada: si no, una
-- subcarpeta pública expondría a toda la familia el contenido de la Caja fuerte.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heredar_privacidad_carpeta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  padre_privada BOOLEAN;
BEGIN
  IF NEW.carpeta_padre_id IS NOT NULL THEN
    SELECT es_privada INTO padre_privada
      FROM public.carpetas WHERE id = NEW.carpeta_padre_id;
    IF padre_privada IS TRUE THEN
      NEW.es_privada := TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heredar_privacidad_carpeta ON public.carpetas;
CREATE TRIGGER trg_heredar_privacidad_carpeta
  BEFORE INSERT OR UPDATE OF carpeta_padre_id, es_privada ON public.carpetas
  FOR EACH ROW EXECUTE FUNCTION public.heredar_privacidad_carpeta();

-- -----------------------------------------------------------------------------
-- 10. Recargar el esquema expuesto por PostgREST
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
