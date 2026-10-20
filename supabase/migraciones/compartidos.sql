-- =============================================================================
-- MIGRACIÓN: Compartido conmigo (cesiones nominales entre miembros)
-- Pegar TODO este fichero en Supabase → SQL Editor → Run, UNA sola vez y
-- entero (si falla una sentencia, el editor aborta el resto: no pegues trozos).
-- Todo es re-ejecutable: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS.
-- Detalle en docs/diseno/compartidos.md
-- =============================================================================

-- 1) Tabla + índices + policies propias --------------------------------------
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

-- 2) Función de visibilidad con herencia --------------------------------------
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

-- 3) Reescribir carpetas_select (DROP primero: las policies no se editan) ----
DROP POLICY IF EXISTS "carpetas_select" ON public.carpetas;
CREATE POLICY "carpetas_select" ON public.carpetas
  FOR SELECT USING (
    public.get_user_role() = 'admin'
    OR public.carpeta_visible_para(auth.uid(), carpetas.id)
  );

-- 4) Reescribir archivos_select ----------------------------------------------
DROP POLICY IF EXISTS "archivos_select" ON public.archivos;
CREATE POLICY "archivos_select" ON public.archivos
  FOR SELECT USING (
    subido_por = auth.uid()
    OR public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.compartidos co
       WHERE co.archivo_id = archivos.id
         AND co.compartido_con = auth.uid()
    )
    OR (
      archivos.carpeta_id IS NOT NULL
      AND public.carpeta_visible_para(auth.uid(), archivos.carpeta_id)
    )
  );
