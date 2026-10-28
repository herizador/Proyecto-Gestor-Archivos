# Diseño: puente WebDAV con escritura

Estado: **Fase A implementada** (2026-10-28). La lectura está en producción y
la escritura `PUT`/`MKCOL`/`DELETE` está en el Worker, apagada por defecto con
`DAV_WRITE="0"`. Fases B (`MOVE`/`COPY`/`PROPPATCH`) y C (`LOCK`/`UNLOCK`)
pendientes. Base: `docs/diseno/webdav.md`.

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

En Fase A, `MOVE`, `COPY`, `PROPPATCH`, `LOCK` y `UNLOCK` responden `501`:
renombrar, mover/copiar y editar Office desde el Explorador todavía no
funcionan. Subir, crear carpetas y borrar archivos sí.


## 1. Objetivo y fases

Permitir guardar, crear carpetas, mover/renombrar y borrar (a papelera) desde el
Explorador/Finder directamente en R2, con las mismas reglas del negocio que la PWA.

- **Fase A (útil sola, implementada):** `PUT` + `MKCOL` + `DELETE` (a
  papelera). Ya permite "guardar desde el PC".
- **Fase B:** `COPY` / `MOVE` + `PROPPATCH[displayname]` (arrastrar y renombrar).
- **Fase C:** `LOCK` / `UNLOCK` (Clase 2: lo que exige Office para editar sin
  abrir en solo-lectura).

### Estado de implementación (2026-10-28)

- Router y flag en `worker/src/index.ts`: `DAV_WRITE="0"` (por defecto),
  `"admin"` (solo administradores) o `"all"`.
- Módulos: `env.ts`, `util.ts`, `supabase.ts`, `arbol.ts`, `props.ts`,
  `lectura.ts` y `escritura.ts`. Sin dependencias nuevas.
- `PUT`, `MKCOL` y `DELETE` de archivo implementados con cupo, límite de 20 MB,
  papelera, ETag/`If-None-Match`/`If-Match` y auditoría (`ACTUALIZAR_WEBDAV`).
- `MOVE`, `COPY`, `PROPPATCH`, `LOCK` y `UNLOCK` responden `501` hasta las
  fases B/C.
- Pruebas: `npx tsc -p worker/tsconfig.json`,
  `npx wrangler deploy --dry-run`, prueba local con Supabase/R2 simulados y
  `worker/test/escritura.mjs` para el Worker desplegado.

## 2. Métodos y códigos

| Método | Comportamiento | Códigos |
|---|---|---|
| `PUT` nuevo | Sube bytes a R2 (streaming) + `INSERT` en `archivos` | `201`, `400` (nombre/basura), `409` (padre), `413` (>20 MB), `507` (sin cupo) |
| `PUT` existente | Sube a una **key nueva**, actualiza la fila y borra la anterior (swap; evita bytes nuevos con metadatos viejos) | `204`, `412` (`If-None-Match: *` o `If-Match`), `507` |
| `MKCOL` | `INSERT` en `carpetas` (nombre 1–100 car.) | `201`, `400` (nombre), `405` (ya existe), `409` (padre inexistente/invisible), `415` (con cuerpo) |
| `DELETE` archivo | Papelera: `UPDATE estado='papelera'` (nunca físico) | `204` |
| `DELETE` carpeta | **Prohibido** → `403` (la app no tiene papelera de carpetas; se borra desde la PWA) | `403` |
| `COPY`/`MOVE` | `UPDATE carpeta_id` y/o `nombre` (+ key R2 intacta: la key no codifica carpeta) | `201`/`204`, `412` (ciclo en carpetas) |
| `PROPPATCH` | Solo `displayname` → renombra (`UPDATE nombre`) | `207`, resto de props → `403` |
| `LOCK`/`UNLOCK` | Ver §6 | `200`, `423`, `409`, `412` |

## 3. Reglas de negocio (réplica exacta de la PWA)

- **Quién puede escribir dónde:** igual que `registrarArchivo()`/`crearCarpeta()`:
  carpeta visible + concordancia de ámbito (común↔pública, privado↔privada).
  El admin puede escribir en privadas ajenas si son visibles (como en la PWA;
  en listado de lectura siguen sin salirle: asimetría conocida y documentada).
- **Keys R2** con el mismo esquema (`comun/...`, `usuarios/<id>/privado/...`)
  según la carpeta destino; el nombre visible (`nombre_original`) se guarda tal
  cual y la key se sanea igual que `buildR2Key()`.
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

## 6. Locks (Fase C, Clase 2)

Nueva tabla (migración + RLS como `tokens_dav`: gestión vía service-role):

```sql
create table if not exists public.locks_dav (
  id          uuid primary key default uuid_generate_v4(),
  recurso_id  uuid not null,          -- archivo o carpeta objetivo
  es_carpeta  boolean not null default false,
  token       text not null unique,    -- opaquelocktoken:<uuid>
  propietario text not null,          -- Displayname del cliente (PC-usuario)
  expira      timestamptz not null,   -- Timeout pedido (defecto 3600 s, tope 24 h)
  fecha_creacion timestamptz not null default now()
);
```

- `LOCK` vacío o con `owner`: crea lock exclusivo (`423` si hay otro vigente).
  `UNLOCK` exige el token (`Lock-Token` header). Caducados se ignoran y se
  limpian de forma oportunista en cada `LOCK`.
- Escritura (`PUT`/`MOVE`/`DELETE`/`PROPPATCH`) sobre recurso bloqueado por otro
  → `423 Locked`. Desbloqueo forzoso: solo por expiración (v1; revocar a mano
  queda como mejora, reutilizando el patrón de `/ajustes`).
- PROPFIND añade `getetag` (`"<tamano>-<epoch>"`, útil también a clientes de
  lectura) y `lockdiscovery` real cuando hay lock.

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

1. **Sobrescritura simple**, sin versionado (no existe tabla de versiones);
   `fecha_subida` y `tamano_bytes` se actualizan. Si el bucket tiene versionado
   de R2 activo, los bytes viejos quedan recuperables por Cloudflare.
2. **`DELETE` de carpeta prohibido en v1** → `403`. La PWA tampoco tiene
   papelera de carpetas; añadirla es una funcionalidad aparte.
3. **Locks de archivo** con timeout por defecto de 1 h y tope de 24 h.
   Desbloqueo forzoso solo por expiración; la revocación manual en `/ajustes`
   queda como mejora.
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
8. **Mover un archivo ajeno a una caja privada**: se rechaza con `403`. El
   listado privado filtra por `subido_por`, así que un admin que moviera un
   archivo de otro usuario a su caja lo dejaría invisible. Si se quiere
   permitir, hay que decidir si se cambia `subido_por` o el filtro de lectura.
9. **Versionado de R2**: recomendable activarlo antes de habilitar
   sobrescrituras; la papelera de la app no cubre los bytes reemplazados por
   un `PUT`.

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
  util.ts         # segmentos, nombres, keys R2, MIME, XML, errores
```

`mover.ts` y `locks.ts` llegarán con las fases B/C. Sin dependencias nuevas:
solo `fetch`, binding `BUCKET` y `crypto.subtle`. `worker/tsconfig.json` ya
incluye `src/**/*.ts`; `npm run build` no toca el Worker.

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

### 12.4 Fase B — `MOVE` + `COPY` + `PROPPATCH` (1 semana)

**`MOVE` archivo / carpeta**

1. Resolver origen (`404` si no es visible); exigir dueño o admin.
2. Parsear `Destination` (absoluto o path), validar **mismo host** y decodificar
   cada segmento; resolver el padre destino. Si no existe → `409`.
3. Si destino existe: `Overwrite: F` → `412`; `Overwrite: T` → archivo destino
   a papelera y seguir; carpeta destino → `409`.
4. Archivo: si el ámbito no cambia, `UPDATE nombre_original, carpeta_id`.
   Si cambia, `get` + `put` en la key nueva (mismo `subido_por` en la ruta
   privada) + `UPDATE ruta_r2, carpeta_id, nombre_original`; si la BD falla,
   borrar la key nueva. El `delete` de la key vieja es best-effort. Si el
   destino es una caja privada y el archivo no es del usuario → `403` (evita
   el archivo invisible por el filtro `subido_por` del listado privado).
5. Carpeta: solo mismo ámbito; `UPDATE nombre, carpeta_padre_id`; anti-ciclo
   subiendo 50 niveles desde el destino. No mover dentro de sí misma/hijas.
6. Auditar `MOVER`/`RENOMBRAR_ARCHIVO`/`RENOMBRAR_CARPETA` con
   `via: 'webdav'`; `201` si el destino no existía, `204` si se reemplazó.

**`COPY` archivo**

1. Mismo origen/permisos; resolver destino.
2. `get` del objeto + `put` en key nueva + `INSERT` en `archivos` con
   `subido_por = user.id` y `carpeta_id` destino.
3. Cupo: el duplicado **suma** bytes; comprobar antes y borrar la key nueva si
   la BD falla → `507`.
4. `201`/`204`. Carpetas → `501` en v1.

**`PROPPATCH`**

1. Parsear XML y aceptar solo `displayname`.
2. Actualizar `nombre_original`/`nombre` con las mismas reglas que `MOVE`.
3. Responder `207 Multi-Status`: `200` para `displayname`; `403` para el resto
   (`Win32LastModifiedTime`, etc.) sin romper la operación.

### 12.5 Fase C — `LOCK` / `UNLOCK` (1 semana)

1. Migración `locks_dav` (§6); RLS y gestión por service-role.
2. `LOCK` con cuerpo `lockinfo`: crear fila, `Timeout` (defecto 3600 s, tope
   86400), token `opaquelocktoken:<uuid>`, respuesta `200` + `Lock-Token` +
   XML `activelock`. Sin cuerpo: refrescar el lock existente si el `If` trae el
   token.
3. `UNLOCK`: validar `Lock-Token`, borrar fila, `204`; token ajeno → `409`.
4. Comprobar locks en `PUT`/`MOVE`/`COPY`/`DELETE`/`PROPPATCH`: si el recurso
   (o un ancestro con lock de carpeta) está bloqueado y el `If` no trae el
   token → `423`. Los locks caducados se ignoran y se limpian de forma
   oportunista.
5. `PROPFIND`: `supportedlock` real, `lockdiscovery` y `getetag`; `OPTIONS`:
   `DAV: 1, 2` y `Allow` completo.
6. **Office**: sin esta fase, Word/Excel abren en solo lectura. Con locks,
   guardar en el sitio funciona; los temporales `~$` se filtran.

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
- **Backup**: activar versionado de R2 (o probar con copias) antes de habilitar
  sobrescrituras, porque un `PUT` destructivo no pasa por la papelera.

Despliegue y activación:

```sh
cd worker
npx wrangler deploy                 # DAV_WRITE="0": solo lectura
# Para probar con el admin, cambiar DAV_WRITE="admin" y volver a desplegar.
# Para toda la familia, DAV_WRITE="all".
node test/escritura.mjs <base> <email> <token> "/Área común/Documentos"
```

Desplegado el **2026-10-28** con `DAV_WRITE="0"`: `OPTIONS` sigue anunciando
`Allow: OPTIONS, PROPFIND, GET, HEAD` y ningún método de escritura está activo.
Antes de pasar a `"admin"`, conviene activar el **versionado de R2** en el panel
de Cloudflare (bucket → Settings → Object versioning): es la única red de
seguridad para los bytes reemplazados por un `PUT`.

### 12.7 Matriz de aceptación

1. Windows 11 monta la unidad, crea carpeta, sube `.txt` de 1 KB y de 19 MB;
   aparecen en la PWA.
2. Subir 21 MB → `413`; con el cupo al límite → `507` y sin objeto huérfano.
3. F2 renombra archivo y carpeta; se ve en la PWA; la key de R2 no cambia.
4. Arrastrar archivo entre carpetas del mismo ámbito → solo cambia
   `carpeta_id`; entre Área común y Mi caja fuerte → bytes reubicados.
5. Supr en archivo → papelera recuperable; Supr en carpeta → `403` claro.
6. Word/Excel: abrir, editar, guardar y cerrar; `~$` no aparece; segundo PC
   concurrente → `423`; tras expirar, se puede volver a editar.
7. `COPY` de archivo → nuevo registro y bytes; `COPY` de carpeta → `501`.
8. `PROPPATCH displayname` → renombra; otras props → `403` sin romper.
9. `If-None-Match: *`, `If-Match`, `Overwrite: F` → `412` cuando toca.
10. Nombres con tildes, `#`, `&`, `%`, espacios y >100 caracteres; sin
    traversal (`..`) ni nombres reservados.
11. Token revocado → `401`; carpeta privada ajena → `404`; admin no ve cajas
    privadas ajenas en el árbol (asimetría documentada).
12. `rclone copy/move/delete` contra el Worker; `wrangler tail` sin errores.

En Fase A ya se pueden validar 1, 2, 5, 9 (solo `PUT`), 10 y 11. Los puntos
3, 4, 6, 7 y 8 necesitan las fases B/C.

### 12.8 Orden de trabajo

| Fase | Entregable | Estado |
|---|---|---|
| F0 | Refactor en módulos + flag `DAV_WRITE` + `sbVoid`/utilidades | Hecho (2026-10-28) |
| A | `PUT`, `MKCOL`, `DELETE` archivo + pruebas locales | Hecho (2026-10-28); falta prueba en Windows real |
| B | `MOVE`, `COPY` archivo, `PROPPATCH`, condicionales completos | Pendiente |
| C | `LOCK`/`UNLOCK`, `lockdiscovery`, Office | Pendiente |
| D | Endurecer, auditoría, rate-limit, documentación y guía familiar | Parcial (rate-limit y auditoría hechos) |

Total: ~3 semanas efectivas. Se puede parar después de A y seguir usando la
PWA para lo demás.

