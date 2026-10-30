# Diseño: puente WebDAV con escritura

Estado: **Fases A y B implementadas** (2026-10-29). La lectura está en producción
y la escritura `PUT`/`MKCOL`/`DELETE`/`MOVE`/`COPY`/`PROPPATCH` está en el
Worker, abierta con `DAV_WRITE="all"`. La Fase C (`LOCK`/`UNLOCK`) sigue
pendiente. Base: `docs/diseno/webdav.md`.

## 0. Respuesta corta

Sí, el Worker puede hacerlo. La lectura ya resuelve el árbol virtual y los
bytes; la escritura es extender los mismos handlers con `PUT`, `MKCOL`,
`MOVE`, `COPY`, `DELETE`, `PROPPATCH` y `LOCK`.

| Pregunta | Respuesta | Matiz |
|---|---|---|
| ¿Subir desde el Explorador? | Sí, `PUT` | Límite 20 MB de la app (Windows WebClient admite 50 MB por defecto). |
| ¿Sobrescribir? | Sí, `PUT` sobre existente | Dueño o admin; `If-None-Match`/`If-Match`; cupo por delta. |
| ¿Renombrar? | Sí, `MOVE` (F2) y `PROPPATCH[displayname]` | No mueve bytes: el nombre visible está en la BD, no en la key de R2. |
| ¿Mover entre carpetas? | Sí | Mismo ámbito: solo `carpeta_id`. Cambio de ámbito: Copy+Delete en R2. |
| ¿Crear carpetas? | Sí, `MKCOL` | Nombre 1–100 caracteres; sin duplicados creados desde el puente. |
| ¿Borrar? | Archivos sí, a papelera | Carpetas no en v1: la PWA no tiene papelera de carpetas. |
| ¿Editar Word/Excel en el sitio? | Solo con `LOCK`/`UNLOCK` (Clase 2) | Sin locks, Office abre en solo lectura; Notepad/Explorador sí escriben. |
| ¿Copiar? | Archivos sí (`COPY`) | Copiar carpetas completas es recursivo y caro: fase posterior. |

Lo que **no** cambia: el Worker usa service-role y debe replicar a mano la
visibilidad/permisos, el cupo de 9 GB, el tope de 20 MB, la papelera de
archivos y la auditoría.

### Qué manda Windows Explorer

| Acción del usuario | Método(s) | Notas |
|---|---|---|
| Crear carpeta | `MKCOL` | Nombre y padre; `405` si ya existe. |
| Guardar / arrastrar archivo | `PUT` | `Content-Length`, `Content-Type`; a veces `Expect: 100-continue`. |
| Renombrar con F2 | `MOVE` | `Destination` + `Overwrite`; normalmente no usa `PROPPATCH`. |
| Mover / cortar y pegar | `MOVE` | Mismo host en `Destination`. |
| Copiar y pegar | `COPY` | Archivos; carpetas en fase posterior. |
| Supr | `DELETE` | Archivo → papelera; carpeta → `403` en v1. |
| Abrir / editar Office | `GET`, `HEAD`, `LOCK`, `PUT`, `UNLOCK` | Sin Clase 2, Word/Excel abren en solo lectura. |
| Propiedades / nombre | `PROPFIND`, `PROPPATCH` | `PROPPATCH[displayname]` llega en Fase B. |

`MOVE`, `COPY` y `PROPPATCH[displayname]` ya funcionan desde la Fase B
(2026-10-29). `LOCK` y `UNLOCK` siguen respondiendo `501`: Word/Excel abren en
solo lectura hasta la Fase C.


## 1. Objetivo y fases

Permitir guardar, crear carpetas, mover/renombrar y borrar (a papelera) desde el
Explorador/Finder directamente en R2, con las mismas reglas del negocio que la PWA.

- **Fase A (útil sola, implementada):** `PUT` + `MKCOL` + `DELETE` (a
  papelera). Ya permite "guardar desde el PC".
- **Fase B (implementada, 2026-10-29):** `COPY` / `MOVE` +
  `PROPPATCH[displayname]` (arrastrar, renombrar y copiar archivos).
- **Fase C (pendiente):** `LOCK` / `UNLOCK` (Clase 2: lo que exige Office para
  editar sin abrir en solo-lectura).

### Estado de implementación (2026-10-29)

- Router y flag en `worker/src/index.ts`: `DAV_WRITE="0"` (por defecto),
  `"admin"` (solo administradores) o `"all"`.
- Módulos: `env.ts`, `util.ts`, `supabase.ts`, `arbol.ts`, `props.ts`,
  `lectura.ts`, `escritura.ts` (Fase A), `mover.ts` y `proppatch.ts` (Fase B).
  Sin dependencias nuevas.
- `PUT`, `MKCOL` y `DELETE` de archivo implementados con cupo, límite de 20 MB,
  papelera, ETag/`If-None-Match`/`If-Match` y auditoría (`ACTUALIZAR_WEBDAV`).
- `MOVE` (archivo y carpeta), `COPY` de archivo y `PROPPATCH[displayname]`
  implementados con `Overwrite`, anti-ciclo de 50 niveles, reubicación de bytes
  al cambiar de ámbito, cupo en copias y auditoría (`MOVER`,
  `RENOMBRAR_ARCHIVO`, `RENOMBRAR_CARPETA`, `COPIAR_WEBDAV`).
- `LOCK` y `UNLOCK` responden `501` hasta la Fase C.
- Pruebas: `npx tsc -p worker/tsconfig.json`,
  `npx wrangler deploy --dry-run`, banco local con Supabase/R2 simulados
  (MOVE/COPY/PROPPATCH incluidos) y `worker/test/escritura.mjs` para el Worker
  desplegado.

## 2. Métodos y códigos

| Método | Comportamiento | Códigos |
|---|---|---|
| `PUT` nuevo | Sube bytes a R2 (streaming) + `INSERT` en `archivos` | `201`, `400` (nombre/basura), `409` (padre), `413` (>20 MB), `507` (sin cupo) |
| `PUT` existente | Sube a una **key nueva**, actualiza la fila y borra la anterior (swap; evita bytes nuevos con metadatos viejos) | `204`, `412` (`If-None-Match: *` o `If-Match`), `507` |
| `MKCOL` | `INSERT` en `carpetas` (nombre 1–100 car.) | `201`, `400` (nombre), `405` (ya existe), `409` (padre inexistente/invisible), `415` (con cuerpo) |
| `DELETE` archivo | Papelera: `UPDATE estado='papelera'` (nunca físico) | `204` |
| `DELETE` carpeta | **Prohibido** → `403` (la app no tiene papelera de carpetas; se borra desde la PWA) | `403` |
| `MOVE` archivo/carpeta | Cambia `carpeta_id` y/o nombre; si cambia de ámbito, reubica los bytes en R2 | `201`/`204`, `403` (permiso/ámbito), `409` (carpeta destino/ciclo), `412` (`Overwrite: F`), `502` (otro host) |
| `COPY` archivo | Nuevo registro y bytes; dueño = quien copia; carpetas → `501` | `201`/`204`, `403`, `409`, `412`, `501`, `507` (sin cupo) |
| `PROPPATCH` | Solo `displayname` → renombra (`UPDATE nombre`) | `207`; `403` para el resto de props; `400`/`409` en el `propstat` de `displayname` |
| `LOCK`/`UNLOCK` | Ver §6 | `200`, `423`, `409`, `412` |

## 3. Reglas de negocio (réplica exacta de la PWA)

- **Quién puede escribir dónde:** igual que `registrarArchivo()`/`crearCarpeta()`:
  carpeta visible + concordancia de ámbito (común↔pública, privado↔privada).
  La Caja fuerte es privada también para el admin: el ámbito privado solo
  resuelve archivos con `subido_por = user.id`.
- **Keys R2** con el mismo esquema (`comun/...`, `usuarios/<id>/privado/...`)
  según la carpeta destino; el nombre visible (`nombre_original`) se guarda tal
  cual y la key se sanea igual que `buildR2Key()`.
- **Raíces de ámbito:** `carpeta_id = null` es ambiguo entre la raíz del Área
  común y la de Mi caja fuerte. El Worker distingue por la key (`/privado/`) y
  nunca lista una raíz privada dentro del Área común.
- **Tope 20 MB** por archivo (`413`). Con `Content-Length` se rechaza antes de
  leer; con chunked se cuenta en streaming y se aborta al pasarlo (intentando
  borrar el parcial en R2).
- **MIME** desde la cabecera `Content-Type`; si falta o es genérico, mapa por
  extensión (mismo que la PWA al subir).
- **Nombres duplicados:** la app los permite; ante ambigüedad en una ruta, manda
  la más antigua (`fecha_creacion` ASC) y se documenta. `MKCOL` sobre nombre
  existente → `405` (no se crean duplicadas desde el puente).
- **Papelera y huérfanos** siguen invisibles en el árbol, como en lectura.

## 4. Cupo 9 GB (la trampa principal)

El trigger `validar_limite_almacenamiento` solo salta en `INSERT`. Por eso:

- `PUT` nuevo: el `INSERT` dispara el trigger; si responde `LIMITE_ALMACENAMIENTO`
  se borra lo subido a R2 y se devuelve **`507 Insufficient Storage`**.
- `PUT` sobrescribiendo: el Worker calcula el delta
  (`nuevo_tamano - tamano_actual + uso_total`) contra `LIMITE_BYTES` **antes** de
  subir; si no cabe → `507` sin tocar nada.
- La cuota de PROPFIND (`quota-available-bytes`) ya expone lo mismo al Explorador.

## 5. Basura de Office y del sistema (filtro obligatorio)

Estos PUT se rechazan con `403` y no tocan ni R2 ni la BD (tampoco se listan):

```
~$*  .tmp  .lock  .~lock.*  desktop.ini  Thumbs.db  .DS_Store  .Spotlight-V100
```

Sin esto, cada guardado de Word/Excel inundaría el almacenamiento y el historial.

## 6. Locks (Fase C, Clase 2) — implementado (2026-10-30)

Tabla `locks_dav` (migración `supabase/migraciones/locks-dav.sql`; RLS activado
sin policies: solo el Worker con service-role la toca):

```sql
create table if not exists public.locks_dav (
  id             uuid primary key default uuid_generate_v4(),
  recurso_id     uuid not null,          -- archivo o carpeta objetivo
  es_carpeta     boolean not null default false,
  profundidad    text not null default 'infinity'
                 check (profundidad in ('0', 'infinity')),
  usuario_id     uuid not null references public.perfiles(id) on delete cascade,
  token          text not null unique,    -- opaquelocktoken:<uuid>
  propietario    text not null,           -- owner del lockinfo (PC-usuario)
  expira         timestamptz not null,    -- Timeout (defecto 3600 s, tope 24 h)
  fecha_creacion timestamptz not null default now()
);

-- Un solo lock exclusivo por recurso, incluso con dos LOCK simultáneos.
create unique index idx_locks_dav_recurso on public.locks_dav(recurso_id);
```

- `LOCK` con cuerpo `lockinfo` crea un lock **exclusivo de escritura**. Sin
  cuerpo (o con cuerpo vacío) refresca el existente si el `If` trae su token.
  `423` si hay otro lock vigente; el mismo usuario puede reemplazar su propio
  lock huérfano (Office reiniciado) al reabrir sin token. `Timeout`: defecto
  3600 s, tope 86400 s (`Infinite` se guarda como 24 h).
- `UNLOCK` exige `Lock-Token` y dueño/admin del recurso; token ajeno o caducado
  → `409`; falta la cabecera → `400`. `204` al liberar.
- Escritura (`PUT`/`MKCOL`/`DELETE`/`MOVE`/`COPY`/`PROPPATCH`) sobre un recurso
  bloqueado → `423 Locked` salvo que la cabecera `If` aporte el token (los
  `Not <token>` no autorizan). Un lock de carpeta con `Depth: infinity` protege
  también a sus descendientes; con `Depth: 0` solo impide crear/quitar hijos,
  no editar los existentes. Los locks caducados se ignoran (`expira > now()`) y
  se limpian de forma oportunista en cada `LOCK`/`UNLOCK`.
- No se anidan bloqueos: si una carpeta superior ya tiene un lock `infinity`,
  bloquear un hijo devuelve `423`. La respuesta `423` **no incluye el token**,
  para que nadie pueda saltarse el bloqueo leyéndolo.
- `PROPFIND` anuncia `supportedlock` (exclusive/write) y `lockdiscovery` real
  (con `locktoken`, `lockroot`, `timeout` y `owner`) tanto en el recurso como
  en los hijos listados. `OPTIONS` responde `DAV: 1, 2` y añade `LOCK`/`UNLOCK`
  a `Allow` cuando `DAV_WRITE` está activo.
- Desbloqueo forzoso: solo por expiración o `UNLOCK` del dueño/admin (v1).
- **Sin migración aplicada** la lectura sigue funcionando (los locks se
  ignoran); `LOCK` devuelve `500` con el aviso de aplicar `locks-dav.sql`.
- Limitación conocida: un lock de carpeta `Depth: infinity` no se muestra en
  el `lockdiscovery` de los hijos (sí se aplica al escribir); Office bloquea y
  libera el archivo concreto que abre, que es el caso real.

## 7. Auditoría

- `PUT` nuevo: el trigger `trg_registrar_subida` ya registra `SUBIR_ARCHIVO` gratis.
- Sobrescritura: nueva acción `ACTUALIZAR_WEBDAV` (union TS; columna TEXT, sin migración).
- `MKCOL` → `CREAR_CARPETA`; `MOVE`/renombrado → `MOVER`; `DELETE` →
  `MOVER_A_PAPELERA`. Todo con `{via: 'webdav'}` en detalles.

## 8. Infra y límites (sin cambios)

Mismo Worker y proyecto: el `PUT` normal llega en streaming (`request.body` →
R2); si el cliente usa chunked sin longitud, se bufferiza ≤20 MB. Cabe en los
tiempos de los Workers. Sin secretos nuevos ni tablas en Vercel. `ultimo_uso`
del token se actualiza también al escribir.

## 9. Matriz de pruebas (extiende la de lectura)

1. Guardar `.txt` nuevo desde Bloc de notas → aparece en la PWA.
2. Sobrescribir PDF → mismo nombre, tamaño y fecha nuevos; cupo casi lleno → `507`.
3. Crear carpeta con `Nuevo` → visible en la PWA; duplicada → error limpio.
4. Arrastrar archivo entre carpetas y renombrar con F2 → OK en PWA.
5. Supr en archivo → va a **papelera** (recuperable); en carpeta → `403`.
6. Word: guardar `.docx` (con temporales `~$` ignorados), cerrar sin UNLOCK →
   expira y se libera; segundo PC concurrente → `423`.
7. `If-None-Match: *` sobre existente → `412`.
8. Nombres con tildes, `#`, `&` y +100 caracteres.

## 10. Estimación

2–3 semanas de trabajo efectivo (A ≈ 40 %, B ≈ 30 %, C ≈ 30 %), 3–4 semanas
de calendario contando pruebas con Windows/Office/macOS. La Fase A ya aporta
valor sola: guardar archivos y crear carpetas desde el PC.

## 11. Decisiones confirmadas (2026-10-28)

1. **Sobrescritura simple**, sin versionado en la app (no existe tabla de
   versiones); `fecha_subida` y `tamano_bytes` se actualizan. **R2 no ofrece
   versionado de objetos** (comprobado en octubre de 2026: el menú del bucket
   solo tiene ciclo de vida y bloqueo), así que los bytes anteriores se pierden
   al sobrescribir. Por eso la escritura se queda en `"admin"` y Windows pide
   confirmación antes de reemplazar. Si se quiere una red de seguridad, hay que
   copiar el objeto viejo a un prefijo `versiones/` desde el Worker (ver §12.6).
2. **`DELETE` de carpeta prohibido en v1** → `403`. La PWA tampoco tiene
   papelera de carpetas; añadirla es una funcionalidad aparte.
3. **Locks de archivo** con timeout por defecto de 1 h y tope de 24 h.
   `UNLOCK` del dueño/admin libera; el desbloqueo forzoso de un lock ajeno
   solo por expiración. La revocación manual en `/ajustes` queda como mejora.
4. **Copiar carpetas** no entra en v1 (recursivo, multiplica bytes y cupo).
   `COPY` de archivos sí.
5. **Tamaño máximo 20 MB**, igual que la PWA. No subir el límite para WebDAV:
   el cupo de 9 GB y el trigger son la fuente de verdad.
6. **Nombres duplicados**: las carpetas resuelven la más antigua
   (`fecha_creacion` ASC) y los archivos el más reciente (`fecha_subida` DESC),
   como ya hace la lectura. `PUT` sobre una ruta existente sobrescribe ese
   archivo; los duplicados ocultos no se tocan. Si una carpeta ocupa el nombre,
   `PUT` devuelve `409` para no escribir en un archivo oculto.
7. **Locks solo sobre recursos existentes** en v1. El *lock-null* (bloquear
   una ruta que aún no existe para crearla) se pospone: Office suele hacer
   `PUT` directo al guardar un archivo nuevo. Si en las pruebas resulta
   imprescindible, se añade en C.2 con una columna de ruta en `locks_dav`.
8. **Mover un archivo a una caja privada**: solo el dueño puede hacerlo
   (`403` en el resto). El listado privado filtra por `subido_por`, así que
   mover el archivo de otro usuario a una caja lo dejaría invisible.
9. **Sin versionado en R2**: el servicio no lo ofrece. La papelera de la app
   no cubre los bytes reemplazados por un `PUT`, así que la única protección
   real es no abrir la escritura a todos o conservar copias propias de las
   versiones anteriores.

## 12. Plan de implementación en el Worker

### 12.1 Estructura del código (implementada en F0)

El Worker pasó de ~470 líneas en un archivo a módulos:

```
worker/src/
  index.ts        # router de métodos, OPTIONS, rate-limit, flag DAV_WRITE
  env.ts          # tipos, constantes y selects
  supabase.ts     # sb()/sbVoid(), autenticar(), tokens, cuota y auditoría
  arbol.ts        # resolver(), hijasDe(), archivosDe(), scope y visibilidad
  props.ts        # xmlPropfind(), ETag, cuota, fechas
  lectura.ts      # GET/HEAD/Range
  escritura.ts    # PUT, MKCOL, DELETE (Fase A)
  mover.ts        # MOVE y COPY (Fase B)
  proppatch.ts    # PROPPATCH[displayname] (Fase B)
  locks.ts        # LOCK/UNLOCK, comprobación de bloqueos y lockdiscovery (Fase C)
  util.ts         # segmentos, nombres, keys R2, MIME, XML, errores
```

Sin dependencias nuevas: solo `fetch`, binding `BUCKET` y `crypto.subtle`.
`worker/tsconfig.json` ya incluye `src/**/*.ts`; `npm run build` no toca el
Worker.

### 12.2 Utilidades nuevas (antes de los handlers)

- `sbVoid()`: PostgREST devuelve `204`/cuerpo vacío en `PATCH`/`DELETE`; el
  `sb()` actual hace `res.json()` y fallaría. Usar `Prefer: return=minimal`.
- `leerCuerpoLimitado(req, max)`: si hay `Content-Length`, rechazar antes de
  leer; si no, contar en streaming y abortar al pasar de 20 MB. R2 `put` con
  `request.body` funciona con longitud fija; para chunked, buffer de ≤20 MB
  (cabe de sobra en memoria del Worker).
- `keyNueva(userId, scope, nombre)`: copia de `buildR2Key()` con **sufijo
  aleatorio** (`crypto.getRandomValues`, 8 hex) para que dos subidas con el
  mismo nombre en el mismo milisegundo no se pisen.
- `nombreValido()`: 1–200 caracteres para archivo, 1–100 para carpeta; sin
  `/`, `\`, NUL ni nombres reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`,
  `COM1..9`, `LPT1..9`). Rechazar `~$*`, `.tmp`, `.lock`, `.~lock.*`,
  `desktop.ini`, `Thumbs.db`, `.DS_Store` y `.Spotlight-V100` en `PUT`/`MKCOL`.
- `mimePorExtension()`: fallback cuando `Content-Type` falta o es genérico.
- `etagDe(archivo)`: `"<tamano>-<epoch de fecha_subida>"`, usado en
  `PROPFIND`, `GET`/`HEAD` y en `If-Match`.
- `responderError(status, texto)`: texto plano, `Cache-Control: no-store`.

### 12.3 Fase A — `PUT` + `MKCOL` + `DELETE` (1 semana)

**`PUT` archivo nuevo**

1. Resolver el padre: `/Área común/...` o `/Mi caja fuerte/...`; el padre debe
   ser una carpeta o el ámbito. Si no existe → `409`; si es un archivo → `409`.
2. Scope: el de la carpeta/ámbito (`comun` si `es_privada=false`; `privado` si
   es la caja del usuario). No confiar en el cliente.
3. Validar nombre y filtro de basura; `Content-Length` > 20 MB → `413`.
4. Cupo: `get_storage_usage()` + tamaño; si supera 9 GB → `507` antes de subir.
5. `BUCKET.put(keyNueva(...), body, { httpMetadata: { contentType } })`.
6. `INSERT` en `archivos` (`nombre_original`, `ruta_r2`, `tamano_bytes`,
   `tipo_mime`, `carpeta_id`, `subido_por`, `estado='activo'`). El trigger
   `trg_registrar_subida` audita y `trg_validar_limite` vuelve a comprobar el
   cupo.
7. Si el `INSERT` falla (cupo, FK, etc.): `BUCKET.delete(key)` best-effort y
   devolver `507`/`500`. Nunca dejar bytes huérfanos por un fallo de BD.
8. `201 Created` + `ETag`.

**`PUT` sobre archivo existente**

1. Resolver el archivo; exigir `subido_por = user.id` o admin.
2. `If-None-Match: *` → `412`. `If-Match` distinto del ETag actual → `412`.
3. Calcular delta de cupo (`nuevo - actual`); si no cabe → `507` sin tocar R2.
4. `BUCKET.put` en una **key nueva** (mismo prefijo/ámbito, sufijo aleatorio);
   nunca se pisan los bytes de la key actual antes de que la BD confirme.
5. `UPDATE archivos` (`ruta_r2` = key nueva, `tamano_bytes`, `tipo_mime`,
   `fecha_subida = now()`). No cambiar `carpeta_id` ni `subido_por`.
6. Si el `UPDATE` falla: borrar la key nueva y conservar la vieja (los bytes
   antiguos siguen siendo válidos). `BUCKET.delete(key vieja)` best-effort solo
   después del `UPDATE` correcto.
7. Auditar `ACTUALIZAR_WEBDAV` con `via: 'webdav'` (el trigger de estado no
   salta porque `estado` no cambia).
8. `204 No Content` + `ETag` nuevo.

**`MKCOL`**

1. Resolver el padre (carpeta o ámbito); si no existe → `409`.
2. Si el nombre ya existe como carpeta o archivo → `405`.
3. `INSERT` en `carpetas` (`nombre`, `creado_por`, `es_privada` según el padre,
   `carpeta_padre_id`; el color por defecto lo pone la BD).
4. Auditar `CREAR_CARPETA` con `via: 'webdav'`; `201`.

**`DELETE` archivo**

1. Resolver; exigir dueño o admin.
2. `UPDATE archivos SET estado='papelera'` (nunca borrar bytes).
3. El trigger `trg_cambio_estado_archivo` audita `MOVER_A_PAPELERA`; `204`.

**`DELETE` carpeta** → `403` con texto claro («usa la PWA»). No borrar en
cascada: la FK `ON DELETE CASCADE` de `carpetas` arrastraría archivos y sus
filas, perdiendo la papelera.

### 12.4 Fase B — `MOVE` + `COPY` + `PROPPATCH` (implementada 2026-10-29)

Implementada en `worker/src/mover.ts` y `worker/src/proppatch.ts`. `OPTIONS`
anuncia `MOVE, COPY, PROPPATCH` cuando `DAV_WRITE` está activo.

**`MOVE` archivo / carpeta**

1. Resolver origen (`404` si no es visible); exigir dueño o admin. La raíz y
   los ámbitos no se mueven (`403`).
2. Parsear `Destination` (absoluto o path), validar **mismo host** (`502` si no)
   y decodificar cada segmento; resolver el padre destino (`409` si no existe).
3. Si el destino existe: `Overwrite: F` → `412`; con `T`, un archivo destino va
   a la papelera y se sigue; una carpeta destino → `409`.
4. Archivo: si el ámbito no cambia, `UPDATE nombre_original, carpeta_id` (la key
   de R2 no cambia). Si cambia, `get` + `put` en la key nueva (la privada usa el
   `subido_por` del archivo) + `UPDATE ruta_r2, carpeta_id, nombre_original`; si
   la BD falla, se borra la key nueva. El `delete` de la key vieja es
   best-effort. Si el destino es una caja privada y el archivo no es del
   usuario → `403` (evita el archivo invisible por el filtro `subido_por`).
5. Carpeta: solo mismo ámbito (`409` si cambia); `UPDATE nombre,
   carpeta_padre_id`; anti-ciclo subiendo 50 niveles desde el destino. No se
   puede mover dentro de sí misma ni de sus hijas.
6. Auditar `MOVER` si cambia el padre y `RENOMBRAR_ARCHIVO`/`RENOMBRAR_CARPETA`
   si cambia el nombre, con `via: 'webdav'`; `201` si el destino no existía,
   `204` si se reemplazó.

**`COPY` archivo**

1. Resolver origen; exigir dueño o admin; las carpetas → `501`.
2. `Destination` como en `MOVE`; mismo host, nombre válido. Origen y destino
   iguales → `403`; carpeta destino → `409`; `Overwrite: F` → `412`.
3. `get` del objeto + `put` en `keyNueva` + `INSERT` en `archivos` con
   `subido_por = user.id` y `carpeta_id` destino. Si el destino existía, se manda
   antes a la papelera.
4. Cupo: se descuentan los bytes del destino reemplazado y se suma el duplicado;
   si no cabe → `507` antes de tocar R2. Si el `INSERT` falla, se borra la key
   nueva. Auditoría `COPIAR_WEBDAV` (el trigger audita además `SUBIR_ARCHIVO`).
5. `201`/`204`.

**`PROPPATCH`**

1. Cuerpo máximo 64 KB; se acepta solo `displayname` (con cualquier prefijo de
   namespace). El resto de propiedades (`Win32LastModifiedTime`, etc.) → `403`.
2. Se aplican las mismas reglas de nombre que `MOVE` (trim, 200/100 caracteres,
   reservados de Windows y duplicados). El recurso debe ser del usuario o admin.
3. Responder `207 Multi-Status`: `200` para `displayname`; `400`/`409` en su
   `propstat` si el nombre no vale o ya existe; `403` para el resto sin romper la
   operación. Auditoría `RENOMBRAR_ARCHIVO`/`RENOMBRAR_CARPETA`.

### 12.5 Fase C — `LOCK` / `UNLOCK` (implementada 2026-10-30)

1. Migración `locks_dav` (§6) con índice único por recurso; RLS sin policies y
   gestión por service-role. **Pendiente de aplicar a mano en Supabase.**
2. `LOCK` con cuerpo `lockinfo`: crear fila, `Timeout` (defecto 3600 s, tope
   86400), token `opaquelocktoken:<uuid>`, respuesta `200` + `Lock-Token` +
   XML `activelock`. Sin cuerpo: refrescar el lock existente si el `If` trae el
   token; el dueño puede reemplazar su propio lock huérfano.
3. `UNLOCK`: validar `Lock-Token`, borrar fila, `204`; token ajeno o caducado
   → `409`; falta la cabecera → `400`.
4. Comprobar locks en `PUT`/`MKCOL`/`MOVE`/`COPY`/`DELETE`/`PROPPATCH`: si el
   recurso (o un ancestro con lock de carpeta `infinity`) está bloqueado y el
   `If` no trae el token → `423`. Los locks caducados se ignoran y se limpian
   de forma oportunista en `LOCK`/`UNLOCK`.
5. `PROPFIND`: `supportedlock` real, `lockdiscovery` y `getetag`; `OPTIONS`:
   `DAV: 1, 2` y `Allow` con `LOCK, UNLOCK`.
6. **Office**: sin esta fase, Word/Excel abren en solo lectura. Con locks,
   guardar en el sitio funciona; los temporales `~$` se filtran. La respuesta
   `423` no revela el token del bloqueo.
7. Banco local con `locks_dav` simulado: creación, refresco, `If`/`Not`,
   `423`, `UNLOCK`, locks de carpeta `0`/`infinity`, caducidad y migración
   ausente. Prueba real ampliada en `worker/test/escritura.mjs`.

### 12.6 Rollout y seguridad

- **Flag `DAV_WRITE`** en `wrangler.toml` (`"0"` por defecto, ya presente). Con
  `"0"`, `OPTIONS`/`Allow` siguen en solo lectura y los métodos de escritura
  devuelven `501`; permite desplegar el código sin abrir la puerta.
- **Beta por rol**: `DAV_WRITE="admin"` para probar con la cuenta admin antes de
  `"all"`.
- **Rate-limit de escritura**: contador por token de 60/min, además del global
  de 300/min (implementado).
- **Auditoría**: las escrituras nuevas usan `via: 'webdav'`; la sobrescritura
  registra `ACTUALIZAR_WEBDAV`; el alta y la papelera los auditan los triggers.
  `ultimo_uso` se actualiza también al escribir (implementado).
- **Rollback**: si algo falla, poner `DAV_WRITE="0"` y redesplegar; los datos
  ya escritos siguen siendo válidos para la PWA.
- **Backup**: R2 **no tiene versionado de objetos**. Antes de habilitar
  sobrescrituras para todos hay dos opciones reales: copias periódicas del
  bucket (rclone u otro script) o versiones propias: copiar la key vieja a
  `versiones/<archivo_id>/<fecha>_<nombre>` antes de borrarla y añadir una
  regla de ciclo de vida que expire ese prefijo a los 90 días. Mientras no
  exista ninguna, `DAV_WRITE="admin"` y sobrescritura deliberada.

Despliegue y activación:

```sh
cd worker
npx wrangler deploy                 # DAV_WRITE="0": solo lectura
# Para probar con el admin, cambiar DAV_WRITE="admin" y volver a desplegar.
# Para toda la familia, DAV_WRITE="all".
node test/escritura.mjs <base> <email> <token> "/Área común/Documentos"
```

Desplegado el **2026-10-28** con `DAV_WRITE="0"` (solo lectura) y el
**2026-10-29** con `"admin"` para la prueba real: smoke y escritura completos en
verde. Tras implementar la Fase B y pasar el banco local, se abrió
`DAV_WRITE="all"` para el PC, los móviles y el portátil de Marina. La prueba
real de Fase B contra producción (token admin temporal) pasó **17/17**: `PUT`,
`GET`, `COPY`, `MOVE` con `Overwrite` y cruce de ámbitos,
`PROPPATCH[displayname]`, `DELETE` y controles de carpeta/raíz. Esa prueba
destapó que la raíz privada (`carpeta_id = null`) se listaba en el Área común;
`archivosDe()` ahora separa ambos ámbitos por el prefijo `/privado/` de la key.
La Caja fuerte queda privada también para el admin con
`supabase/migraciones/privacidad-caja-fuerte.sql` (sin bypass de admin en
`carpetas_select`/`archivos_select`). R2 **no ofrece versionado de objetos**:
una sobrescritura es definitiva; la copia de seguridad local periódica queda
pendiente.

La **Fase C** (`LOCK`/`UNLOCK`, Clase 2) está implementada en el Worker y el
banco local pasa en verde. Para usarla hay que aplicar
`supabase/migraciones/locks-dav.sql` en Supabase → SQL Editor y desplegar el
Worker; hasta entonces `LOCK` responde `500` con el aviso de la migración (la
lectura y el resto de escrituras siguen funcionando). Después hay que probar
Office en Windows (abrir, editar, guardar, cerrar) y el segundo PC concurrente.

### 12.7 Matriz de aceptación

1. Windows 11 monta la unidad, crea carpeta, sube `.txt` de 1 KB y de 19 MB;
   aparecen en la PWA.
2. Subir 21 MB → `413`; con el cupo al límite → `507` y sin objeto huérfano.
3. F2 renombra archivo y carpeta; se ve en la PWA; la key de R2 no cambia.
4. Arrastrar archivo entre carpetas del mismo ámbito → solo cambia
   `carpeta_id`; entre Área común y Mi caja fuerte → bytes reubicados.
5. Supr en archivo → papelera recuperable; Supr en carpeta → `403` claro.
6. Word/Excel: abrir, editar, guardar y cerrar; `~$` no aparece; segundo PC
   concurrente → `423`; tras expirar o `UNLOCK`, se puede volver a editar.
7. `COPY` de archivo → nuevo registro y bytes; `COPY` de carpeta → `501`.
8. `PROPPATCH displayname` → renombra; otras props → `403` sin romper.
9. `If-None-Match: *`, `If-Match`, `Overwrite: F` → `412` cuando toca.
10. Nombres con tildes, `#`, `&`, `%`, espacios y >100 caracteres; sin
    traversal (`..`) ni nombres reservados.
11. Token revocado → `401`; carpeta privada ajena → `404`; el admin tampoco
    ve las cajas privadas ajenas en el árbol ni en la PWA.
12. `rclone copy/move/delete` contra el Worker; `wrangler tail` sin errores.

En Fase B se validan 1–5 y 7–11. El punto 6 (Office) se valida con la Fase C
tras aplicar `locks-dav.sql`; el 12 (rclone) depende del cliente que se use.

### 12.8 Orden de trabajo

| Fase | Entregable | Estado |
|---|---|---|
| F0 | Refactor en módulos + flag `DAV_WRITE` + `sbVoid`/utilidades | Hecho (2026-10-28) |
| A | `PUT`, `MKCOL`, `DELETE` archivo + pruebas locales | Hecho (2026-10-28); falta prueba en Windows real |
| B | `MOVE`, `COPY` archivo, `PROPPATCH`, condicionales completos | Hecho (2026-10-29); banco local en verde |
| C | `LOCK`/`UNLOCK`, `lockdiscovery`, Office | Hecho (2026-10-30); pendiente aplicar migración y prueba real |
| D | Endurecer, auditoría, rate-limit, documentación y guía familiar | Parcial (rate-limit, auditoría y guía hechos) |

Total: ~3 semanas efectivas. Se puede parar después de A y seguir usando la
PWA para lo demás.

