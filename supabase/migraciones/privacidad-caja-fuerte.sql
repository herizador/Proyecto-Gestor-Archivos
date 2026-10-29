-- Privacidad de «Mi caja fuerte» (2026-10-29)
-- ---------------------------------------------------------------------------
-- Hasta ahora, las policies de SELECT daban al admin visibilidad total, así
-- que podía listar y abrir archivos privados de otros miembros desde /todos,
-- /recientes o la papelera. La Caja fuerte debe ser privada incluso para el
-- administrador: solo la ve su dueño, quien la tenga compartida y, en el caso
-- de archivos, quien tenga un enlace directo.
--
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.
-- Este mismo cambio está ya reflejado en supabase/schema.sql.
-- ---------------------------------------------------------------------------

-- Carpetas: pública, propia, compartida conmigo o con un ancestro visible.
DROP POLICY IF EXISTS "carpetas_select" ON public.carpetas;
CREATE POLICY "carpetas_select" ON public.carpetas
  FOR SELECT USING (
    public.carpeta_visible_para(auth.uid(), carpetas.id)
  );

-- Archivos: propio, compartido, dentro de una carpeta visible o en la raíz
-- del Área común (carpeta_id NULL y key que no sea /privado/).
DROP POLICY IF EXISTS "archivos_select" ON public.archivos;
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
