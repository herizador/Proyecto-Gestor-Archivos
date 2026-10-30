-- Bloqueos WebDAV (Fase C: LOCK/UNLOCK) — 2026-10-30
-- ---------------------------------------------------------------------------
-- Office abre un archivo en solo lectura si el servidor no anuncia WebDAV
-- Clase 2. Esta tabla guarda los bloqueos exclusivos de escritura que emite el
-- Worker para que Word/Excel/PowerPoint puedan editar y guardar.
--
-- Solo la usa el Worker con service-role: RLS activado sin policies (denegado
-- al resto). Los bloqueos caducan solos y se limpian de forma oportunista en
-- cada LOCK/UNLOCK. No hay versionado de archivos: el bloqueo evita
-- sobrescrituras simultáneas, no recupera versiones anteriores.
--
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.
-- Este mismo cambio está reflejado en supabase/schema.sql.
-- Ver docs/diseno/webdav-escritura.md §6.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.locks_dav (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  recurso_id      UUID        NOT NULL,          -- archivo o carpeta bloqueado
  es_carpeta      BOOLEAN     NOT NULL DEFAULT FALSE,
  profundidad     TEXT        NOT NULL DEFAULT 'infinity'
                              CHECK (profundidad IN ('0', 'infinity')),
  usuario_id      UUID        NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  propietario     TEXT        NOT NULL,          -- Displayname del cliente (PC-usuario)
  token           TEXT        NOT NULL UNIQUE,    -- opaquelocktoken:<uuid>
  expira          TIMESTAMPTZ NOT NULL,           -- Timeout (defecto 3600 s, tope 24 h)
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un recurso solo puede tener un bloqueo exclusivo vigente. Los caducados se
-- borran antes de crear uno nuevo; el índice evita dos LOCK simultáneos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_locks_dav_recurso
  ON public.locks_dav(recurso_id);

CREATE INDEX IF NOT EXISTS idx_locks_dav_expira
  ON public.locks_dav(expira);

ALTER TABLE public.locks_dav ENABLE ROW LEVEL SECURITY;

-- Sin policies: la PWA no lee ni escribe bloqueos. El Worker usa service-role.
