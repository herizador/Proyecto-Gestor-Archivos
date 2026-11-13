-- -----------------------------------------------------------------------------
-- carpetas_select: permitir el RETURNING de un INSERT propio
--
-- Síntoma: al crear una carpeta, la app recibía
--   42501: new row violates row-level security policy for table "carpetas"
-- aunque el WITH CHECK de `carpetas_insert` sí se cumplía (subir archivos
-- funcionaba con normalidad).
--
-- Causa: el RETURNING de un INSERT vuelve a evaluar la policy SELECT de la
-- tabla. `carpeta_visible_para()` es STABLE y consulta `carpetas` con el
-- snapshot de la sentencia, así que NO puede ver la fila que se acaba de
-- insertar en la misma sentencia: devolvía FALSE y Postgres abortaba el INSERT.
--
-- Arreglo: añadir `creado_por = auth.uid()` como primera condición. Se evalúa
-- directamente sobre la fila nueva, sin releer la tabla. NO amplía la
-- visibilidad: `carpeta_visible_para()` ya devuelve TRUE cuando
-- `creado_por = p_uid`, así que el conjunto de carpetas visibles es el mismo.
--
-- Idempotente: se puede pegar tal cual en Supabase → SQL Editor.
-- La app ya no depende de esto (inserta sin RETURNING), pero deja la policy
-- a prueba de futuros `.insert(...).select()`.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "carpetas_select" ON public.carpetas;
CREATE POLICY "carpetas_select" ON public.carpetas
  FOR SELECT USING (
    creado_por = auth.uid()
    OR public.carpeta_visible_para(auth.uid(), carpetas.id)
  );

-- Comprobación rápida tras aplicar:
--   SELECT polname, pg_get_expr(polqual, polrelid)
--     FROM pg_policy
--    WHERE polrelid = 'public.carpetas'::regclass AND polname = 'carpetas_select';
