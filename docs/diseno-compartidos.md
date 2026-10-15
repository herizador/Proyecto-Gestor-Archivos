# Diseño: Compartido conmigo (cesión entre miembros)

Estado: **especificación** (Fase 2 Figma). No implementar hasta cerrar favoritos.
Hoy compartir es solo por enlace público (`/compartir`, quien tenga el token entra)
o accesos propios. Esto añade cesiones nominales: "esto lo ve también Eloísa".

## 1. Modelo (una tabla)

```sql
create table if not exists public.compartidos (
  id             uuid primary key default uuid_generate_v4(),
  creado_por     uuid not null references public.perfiles(id) on delete cascade,
  compartido_con uuid not null references public.perfiles(id) on delete cascade,
  archivo_id     uuid references public.archivos(id) on delete cascade,
  carpeta_id     uuid references public.carpetas(id) on delete cascade,
  fecha_creacion timestamptz not null default now(),
  constraint chk_compartido_un_recurso check (
    (archivo_id is not null and carpeta_id is null) or
    (archivo_id is null and carpeta_id is not null)
  ),
  constraint chk_no_autocompartir check (creado_por <> compartido_con)
);

create unique index if not exists uq_compartido_archivo
  on public.compartidos(compartido_con, archivo_id) where archivo_id is not null;
create unique index if not exists uq_compartido_carpeta
  on public.compartidos(compartido_con, carpeta_id) where carpeta_id is not null;

alter table public.compartidos enable row level security;

-- Ver: el destinatario y el admin
create policy "compartidos_select" on public.compartidos
  for select using (compartido_con = auth.uid() or public.get_user_role() = 'admin');
-- Crear/borrar: el dueño del recurso o admin (la action lo verifica además)
create policy "compartidos_insert" on public.compartidos
  for insert with check (creado_por = auth.uid());
create policy "compartidos_delete" on public.compartidos
  for delete using (creado_por = auth.uid() or compartido_con = auth.uid() or public.get_user_role() = 'admin');
```

## 2. Cirugía RLS — IMPLEMENTADA en `supabase/schema.sql`

> Respuesta a "¿dónde pongo el OR EXISTS?": **dentro del `USING` de cada policy**,
> y las policies no se editan: se hace `DROP POLICY IF EXISTS` + `CREATE POLICY`
> de nuevo. Pero ojo: el `OR EXISTS` directo solo cubre cesiones directas (una
> carpeta compartida se vería **vacía**, porque hijas y archivos no están
> compartidos uno a uno). La versión final usa `carpeta_visible_para()` con
> herencia. Para aplicarlo, ejecuta en SQL Editor los bloques de `schema.sql`
> en este orden: tabla `compartidos` (+ índices + policies), función
> `carpeta_visible_para`, y los pares DROP+CREATE de `archivos_select` y
> `carpetas_select`. Todo es re-ejecutable (`IF NOT EXISTS` / `OR REPLACE` /
> `DROP ... IF EXISTS`).

```sql
-- El OR EXISTS directo (solo cesiones directas de archivos) vive así dentro
-- de archivos_select; las carpetas y la herencia van por la función:
or exists (
  select 1 from public.compartidos co
  where co.archivo_id = archivos.id and co.compartido_con = auth.uid()
)
```

Punto delicado: **herencia**. Si te comparten una carpeta privada, debes ver sus
hijas y archivos aunque no sean tuyos ni públicos. Las policies actuales miran
`c.es_privada = FALSE` o propiedad; hay que añadir "o la cadena de padres pasa
por una carpeta compartida conmigo". Esto se implementa con una función
`public.es_visible_para(uid, carpeta_id)` recursiva (máx 50 niveles, como el
anti-ciclo de accesos) y reescribiendo ambas policies sobre ella. **Probar con
EXPLAIN en cada cambio**: un EXISTS recursivo por fila puede degradar listados
grandes; si duele, materializar `ruta` (ltree o array de ancestros) en carpetas.

## 3. Acciones — IMPLEMENTADO en `actions/compartir-usuarios.ts`

- `compartirCon({ tipo, id, usuarioId })`: verifica que soy dueño o admin del
  recurso, que el destino es otro miembro, inserta (duplicado = omitido) y audita
  `COMPARTIR_USUARIO` (nuevo miembro del union TS; columna TEXT, sin migración).
- `dejarDeCompartir({ tipo, id, usuarioId })` + `listarCompartidoConmigo()` que
  devuelve archivos/carpetas resueltos (reutilizar el patrón de
  `enriquecerAccesos`: base + lotes, nunca joins por FK).
- `listarMiembros()` para el selector (perfiles visibles según RLS).

## 4. UI — IMPLEMENTADA (`CompartirDialog.tsx` en el ⋯, página `/compartido`)

- Diálogo "Compartir" en el ⋯ de archivos/carpetas propios (selector de miembro
  + resumen de con quién ya está compartido + revocar). Reutiliza el modal por
  portal de `NuevoAccesoModal`.
- Página **Compartido conmigo** (sidebar, icono `UserCheck`): reutiliza
  `FileListWrapper` en solo-lectura (sin papelera/enlace: `isAdmin=false`,
  `isOwner=false` salvo lo propio) + badge "Compartido por X".
- Badge en tarjetas compartidas por mí (opcional v2): "Compartido con N".

## 5. Qué NO cambia

- `/compartir` por token sigue igual (público con enlace).
- Los accesos directos no entran (son vistas propias, no cesiones).
- WebDAV: los compartidos conmigo aparecen en el árbol (misma visibilidad).
- Papelera: si el dueño borra el original, el destinatario lo ve huérfano
  (mismo patrón que accesos huérfanos).

## 6. Matriz de pruebas

1. Comparto carpeta privada con Eloísa → ella la ve navegable con hijas y archivos.
2. Revoco → desaparece al refrescar (sin error visible).
3. Comparto archivo suelto → aparece en su página con descargar/visualizar.
4. Dueño lo manda a papelera → destinatario ve "no disponible", no error.
5. Rendimiento: EXPLAIN del listado con 500 archivos y cesiones activas.
6. Admin ve todo igual que antes (sin regresiones de RLS).

## 7. Estimación

Diseño cerrado aquí; implementación ~1 semana (RLS + actions + diálogo + página
+ pruebas), más migración SQL por tu parte como siempre.
