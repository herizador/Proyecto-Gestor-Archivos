# Diseño: puente WebDAV con escritura (fase futura)

Estado: **especificación** (2026-10-08). No implementar hasta que la lectura
ruede unas semanas. Base: `docs/diseno-webdav.md` (solo-lectura, en producción).

## 1. Objetivo y fases

Permitir guardar, crear carpetas, mover/renombrar y borrar (a papelera) desde el
Explorador/Finder directamente en R2, con las mismas reglas del negocio que la PWA.

- **Fase A (útil sola):** `PUT` + `MKCOL` + `DELETE` (a papelera). Ya permite
  "guardar desde el PC".
- **Fase B:** `COPY` / `MOVE` + `PROPPATCH[displayname]` (arrastrar y renombrar).
- **Fase C:** `LOCK` / `UNLOCK` (Clase 2: lo que exige Office para editar sin
  abrir en solo-lectura).

## 2. Métodos y códigos

| Método | Comportamiento | Códigos |
|---|---|---|
| `PUT` nuevo | Sube bytes a R2 (streaming) + `INSERT` en `archivos` | `201`, `413` (>20 MB), `507` (sin cupo), `415`/`403` (basura Office, §5) |
| `PUT` existente | Sobrescribe misma key + `UPDATE` tamaño/fecha (ver §4) | `204`, `412` (con `If-None-Match: *`), `507` |
| `MKCOL` | `INSERT` en `carpetas` (nombre 1–100 car.) | `201`, `405` (ya existe), `409` (padre inexistente/invisible) |
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

Mismo Worker y proyecto: el `PUT` llega en streaming (`request.body` → R2, sin
cargar 20 MB en memoria) y cabe en los tiempos de los Workers. Sin secretos
nuevos ni tablas en Vercel. `ultimo_uso` del token se actualiza también al escribir.

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

2–3 semanas con pruebas Office/Windows/macOS (A ≈ 40 %, B ≈ 30 %, C ≈ 30 %).

## 11. Decisiones abiertas

1. Sobrescritura simple (propuesto) vs versionado (fuera de alcance: no existe
   tabla de versiones).
2. `DELETE` de carpeta: prohibido (propuesto) vs papelera de carpetas (nueva
   funcionalidad también para la PWA).
3. Timeout de lock por defecto (propuesto: 1 h, tope 24 h).
4. Desbloqueo forzoso manual en `/ajustes` (propuesto: solo expiración en v1).
