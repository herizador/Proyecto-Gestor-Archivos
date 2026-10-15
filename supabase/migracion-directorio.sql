-- =============================================================================
-- MIGRACIÓN: directorio familiar (necesario para Compartido conmigo)
-- Pegar entero en Supabase → SQL Editor → Run. Re-ejecutable.
-- Sin esta policy, los no-admin solo se ven a sí mismos y no pueden elegir a
-- quién ceder (el selector de miembros saldría vacío).
-- =============================================================================

DROP POLICY IF EXISTS "perfiles_select_directorio" ON public.perfiles;
CREATE POLICY "perfiles_select_directorio" ON public.perfiles
  FOR SELECT TO authenticated USING (true);
