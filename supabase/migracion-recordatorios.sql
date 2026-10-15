-- =============================================================================
-- MIGRACIÓN: recordatorios + actividad propia (portada /inicio)
-- Pegar entero en Supabase → SQL Editor → Run. Re-ejecutable.
-- - recordatorios: avisos de vencimiento por usuario (NUNCA borran archivos,
--   solo avisan). Pueden ir ligados a un archivo/carpeta o ser generales.
-- - historial_select_propio: cada miembro ve SUS filas (el admin ya ve todo).
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

-- Actividad propia: sin esto los no-admin no ven ni su historial (la policy
-- existente es solo-admin). La actividad ajena sigue vetada por privacidad.
DROP POLICY IF EXISTS "historial_select_propio" ON public.historial_actividad;
CREATE POLICY "historial_select_propio" ON public.historial_actividad
  FOR SELECT USING (usuario_id = auth.uid());
