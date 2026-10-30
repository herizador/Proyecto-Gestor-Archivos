# Diseño: puente WebDAV (ver R2 en el Explorador)

Estado: **lectura en producción**; Fases A y B de escritura implementadas
(2026-10-29) y abiertas con `DAV_WRITE="all"`. Este documento describe el
diseño base de lectura. Objetivo: ver, abrir y organizar los archivos del
gestor desde el Explorador de Windows / Finder / apps Android con WebDAV, sin
descargar antes y sin salir del modelo de permisos de la app. La escritura
(`PUT`/`MKCOL`/`DELETE`/`MOVE`/`COPY`/`PROPPATCH`) se detalla en
`docs/diseno/webdav-escritura.md`.

## 1. Por qué no vive en la app Next.js (restricción verificada)

- Los route handlers de Next.js App Router solo aceptan
  `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`; cualquier `PROPFIND` devuelve
  **405 Method Not Allowed** (docs oficiales de Next.js). En Vercel no hay
  forma de servir WebDAV desde esta app.
- Precedente válido: `abersheeran/r2-webdav` demuestra que un **Cloudflare
  Worker + binding R2** sí sirve WebDAV (los Workers aceptan cualquier método).
  Ese proyecto usa una sola credencial para todo el bucket: aquí necesitamos
  **multiusuario con las reglas de visibilidad de la app**, así que se construye
  a medida (no se reutiliza tal cual).

## 2. Arquitectura

```
Explorador Win / Finder (https://dav.tu-dominio.com)
        │  HTTPS + Basic (email + token de Explorador)
        ▼
Cloudflare Worker `dav` (carpeta worker/, deploy con wrangler, separado de Vercel)
   ├─ auth: valida token contra Supabase (service-role, ver §4)
   ├─ árbol: lee carpetas/archivos de Supabase (service-role + filtro manual §5)
   └─ bytes: binding R2 del mismo bucket (sin credenciales en código, streaming)
```

- **Vercel** no se toca. El Worker vive en `worker/` con su propio
  `wrangler.toml`; despliegue independiente.
- Coste esperado: plan Workers gratuito suficiente (PROPFIND = consultas
  ligeras; los GET hacen streaming sin apenas CPU). R2: lecturas de volumen
  familiar, despreciables.

## 3. Alcance de lectura y escritura

| Método   | Estado              | Notas                                            |
|----------|---------------------|--------------------------------------------------|
| OPTIONS  | Sí              | `DAV: 1` en solo lectura y `DAV: 1, 2` con escritura; `Allow` añade `PUT, MKCOL, DELETE, MOVE, COPY, PROPPATCH, LOCK, UNLOCK` si `DAV_WRITE` está activo |
| PROPFIND | Sí (depth 0/1)  | `infinity` se trata como `1`; incluye `getetag`  |
| GET      | Sí (+ `Range`)  | Streaming desde el binding R2                    |
| HEAD     | Sí              | Mismas cabeceras que GET, sin cuerpo             |
| PUT/DELETE/MKCOL | Fase A (tras `DAV_WRITE`) | Archivos a papelera; carpetas no se borran |
| COPY/MOVE/PROPPATCH | Fase B (tras `DAV_WRITE`) | `COPY` solo archivos; `MOVE` de carpeta en su ámbito; `PROPPATCH[displayname]` |
| LOCK/UNLOCK | Fase C (tras `DAV_WRITE`) | Clase 2: Office edita en el sitio; token privado del dueño |

## 4. Autenticación (Basic + tokens de Explorador)

Windows y Finder piden **Basic auth**; no vale pedir la contraseña de Supabase
en cada PROPFIND (el cliente la reenvía decenas de veces). Solución: tokens
revocables por dispositivo.

```sql
-- Añadir a supabase/schema.sql (se aplica a mano, como el resto del esquema)
create table if not exists public.tokens_dav (
  id          uuid primary key default uuid_generate_v4(),
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  nombre      text not null,                      -- "Portátil trabajo", p.ej.
  token_hash  text not null unique,               -- SHA-256 hex del token
  revocado    boolean not null default false,
  ultimo_uso  timestamptz,
  fecha_creacion timestamptz not null default now()
);
create index if not exists idx_tokens_dav_usuario on public.tokens_dav (usuario_id);
alter table public.tokens_dav enable row level security;

-- La PWA (server actions con sesión de usuario) gestiona tokens propios;
-- el admin además puede ver/revocar los de todos. El Worker usa service-role
-- (bypasea RLS). El token en claro solo existe al crearlo: nunca se guarda.
drop policy if exists "tokens_dav_select" on public.tokens_dav;
create policy "tokens_dav_select" on public.tokens_dav
  for select using (usuario_id = auth.uid() or public.get_user_role() = 'admin');

drop policy if exists "tokens_dav_insert" on public.tokens_dav;
create policy "tokens_dav_insert" on public.tokens_dav
  for insert with check (usuario_id = auth.uid());

drop policy if exists "tokens_dav_update" on public.tokens_dav;
create policy "tokens_dav_update" on public.tokens_dav
  for update using (usuario_id = auth.uid() or public.get_user_role() = 'admin');

drop policy if exists "tokens_dav_delete" on public.tokens_dav;
create policy "tokens_dav_delete" on public.tokens_dav
  for delete using (usuario_id = auth.uid() or public.get_user_role() = 'admin');
```

- Flujo: `PROPFIND` trae `Authorization: Basic base64(email:token)` → el Worker
  calcula `SHA-256(token)` y busca en `tokens_dav` (`revocado = false`) →
  obtiene `usuario_id` (+ `rol` desde `perfiles`) → aplica visibilidad (§5).
  Sin credenciales → `401` con `WWW-Authenticate: Basic realm="Gestor Familiar"`.
- UI en la PWA (nueva página **`/ajustes`** + enlace en el sidebar):
  crear token (se muestra **una sola vez**), listar por nombre/último uso,
  revocar. Server actions nuevas en `actions/dav.ts`
  (`crearTokenDav`, `revocarTokenDav`, `listarTokensDav`).
- Secretos **solo en el Worker** (nunca en el repo): `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, binding R2 al bucket.

## 5. Árbol virtual y visibilidad (espejo de RLS, a mano)

El Worker usa service-role (bypasea RLS), así que **replica las reglas**:

```
/Área común/...     ← carpetas con es_privada = false (toda la jerarquía pública)
/Mi caja fuerte/... ← carpetas con es_privada = true Y creado_por = usuario
                      (igual que /mi-caja-fuerte: también para admin, solo propias)
```

- Archivos: solo `estado = 'activo'`; los de papelera y los huérfanos no existen
  (los accesos directos **no** se exponen: el árbol muestra originales).
- Nombres: se sirven tal cual (`nombre_original` / `nombre`); la URL usa
  `encodeURIComponent` por segmento (ojo con `ñ`, tildes y `#`). Las colecciones
  terminan en `/` (el cliente Windows lo exige para distinguir carpetas).
- Raíz `/` lista las dos colecciones según lo que vea el usuario.

## 6. Protocolo (mínimo para que Windows monte y navegue)

- `207 Multi-Status` con `resourcetype` (`<collection/>` o vacío),
  `displayname`, `getcontentlength` (solo ficheros), `getcontenttype`,
  `getetag` (ficheros), `getlastmodified` (formato RFC 1123), `creationdate`
  (ISO 8601), `supportedlock` vacío (anuncia Class 1 sin locks).
- `GET`: `Content-Type` del `tipo_mime`, `Content-Length`, `ETag`,
  `Accept-Ranges: bytes` (+ `206` si hay `Range`, que Office/pdfs piden).
- Errores: `401` sin auth, `404` si el id no existe o no es visible
  (**nunca distinguir "no existe" de "sin permiso"**), `501` a las escrituras
  no implementadas o si `DAV_WRITE="0"`.

## 7. Auditoría

Nueva acción `ACCESO_WEBDAV` (union TS en `types/database.ts`; la columna es
`TEXT`, no requiere migración): el Worker inserta en `historial_actividad`
vía service-role en cada `GET` (`{archivo_id, via: 'webdav'}`).
La policy `historial_insert_sistema` ya permite INSERT. La escritura añade
`ACTUALIZAR_WEBDAV` en las sobrescrituras; el alta y la papelera los auditan
los triggers existentes (`SUBIR_ARCHIVO`, `MOVER_A_PAPELERA`).

## 8. Quirks de cliente (verificados)

- Windows: tope de **50 MB** por defecto (`FileSizeLimitInBytes`) → nuestros
  archivos son máx **20 MB**: sin tocar el registro. Requiere HTTPS con Basic
  (lo tenemos) y el servicio **WebClient** activo. Office abrirá en solo lectura.
- macOS Finder → "Conectar al servidor" con la misma URL. Android → Solid
  Explorer / Material Files / CX Explorador (todos hablan WebDAV).

## 9. Plan de pruebas (matriz mínima)

1. Windows 11: "Conectar a unidad de red" → navegar, abrir PDF e imagen,
   copiar a disco, abrir docx con Office (solo lectura).
2. macOS Finder: montar y previsualizar.
3. `rclone ls` contra el Worker (cliente de referencia, sin quirks).
4. Token revocado → `401`; usuario no admin no ve cajas ajenas; papelera invisible.
5. Carga: PROPFIND de carpeta con 200 archivos (paginación/límite si hace falta).

## 10. Estimación y fases

- **F1 (diseño)**: hecho. ✅
- **F2 (prototipo)**: hecho ✅ — Worker (auth + PROPFIND + GET + Range + cuota),
  migración `tokens_dav`, `/ajustes` con crear/revocar.
- **F3 (endurecer)**: hecho ✅ — rate-limit aproximado en memoria del isolate
  (30/min por IP sin auth, 300/min por token; `429` + `Retry-After`), `Cache-Control:
  no-store` en todo, tope de 25 segmentos, `Allow` en el `501`, `ultimo_uso` +
  auditoría `ACCESO_WEBDAV` en cada GET, script `worker/test/smoke.mjs` y guía
  `docs/guias/alta-explorador.md`.
- **Fases A, B, C y D de escritura implementadas** (2026-10-29/30): `PUT`,
  `MKCOL`, `DELETE` de archivo, `MOVE` (archivo/carpeta), `COPY` de archivo,
  `PROPPATCH[displayname]`, `LOCK`/`UNLOCK`, abiertas con `DAV_WRITE="all"`.
  Office edita en el sitio y el segundo dispositivo concurrente recibe `423`.
  Plan y detalle en `docs/diseno/webdav-escritura.md`.

## 11. Decisiones (cerradas 2026-10-04)

1. Subdominio: `https://gestor-familiar.id386827.workers.dev` (workers.dev de su
   cuenta; sin dominio propio de momento).
2. Caducidad: **solo revocación manual** (sin expiración automática).
3. UI de tokens: página **`/ajustes`**; cada usuario gestiona los suyos y el
   admin además puede ver/revocar los de todos (ver policies en §4).

## 12. Despliegue y alta (F2 implementado)

1. Supabase: tabla `tokens_dav` aplicada vía SQL Editor (ver §4 y
   `supabase/schema.sql`, fuente de verdad del esquema).
2. En `worker/wrangler.toml`: poner la `SUPABASE_URL` real.
3. Secretos (una vez, nunca en el repo):
   `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (valor: service_role de
   Supabase → Project Settings → API).
4. Desplegar desde `worker/`: `npx wrangler deploy` (sustituye el worker actual).
5. En la PWA (`/ajustes`): crear una "contraseña de Explorador" por dispositivo.
6. En Windows: Explorador → "Conectar a unidad de red" →
   `https://gestor-familiar.id386827.workers.dev` → usuario = tu email,
   contraseña = el token. En macOS: Finder → "Conectar al servidor".
7. `tsconfig.json` excluye `worker/` (tipos propios mínimos en
   `worker/src/worker-env.d.ts`, sin dependencias): `npm run build` no lo toca.
