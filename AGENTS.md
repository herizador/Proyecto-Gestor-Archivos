# AGENTS.md — gestor-archivos-familia

## Idioma
- Responde y comunica siempre en español (prompts, explicaciones y comentarios de código).
- UI, SQL y comentarios del repo ya están en español: manténlo.

## Comandos
```sh
npm run dev      # servidor Next.js
npm run build    # build producción (verificación principal)
npm run lint     # ESLint (sin prettier/biome)
# Sin framework de tests: verifica con build + lint
```

## Stack y estructura
- **Next.js 16 App Router + React 19**, **TypeScript 5 strict**, **npm**. Alias `@/*` → raíz `./*`.
- **Supabase** (PostgreSQL + Auth SSR + RLS) para auth y metadatos. Fuente de verdad del esquema: `supabase/schema.sql` (se aplica a mano en Dashboard → SQL Editor); `types/database.ts` es su espejo manual.
- **Cloudflare R2** (S3-compatible) para los ficheros. Subida directa navegador → R2 con URL pre-firmada.
- **PWA**: `public/sw.js` + `public/manifest.json`, registro en `app/layout.tsx`.
- Server Actions en `actions/` (`auth.ts`, `files.ts`, `folders.ts`, `storage.ts`, `share.ts`). Clientes Supabase: `lib/supabase/client.ts` (browser) y `lib/supabase/server.ts` (server con cookies). R2 en `lib/r2/client.ts`, normalización de URLs en `lib/presigned-url.ts`.
- Rutas: `/login` (pública), `/` (común), `/familia`, `/mi-caja-fuerte`, `/papelera`, `/admin/historial`, `/admin/usuarios`, `/compartir?token=xyz` (pública). `middleware.ts` refresca sesión, redirige sin sesión a `/login`, de `/login` con sesión a `/`, y exige rol `admin` en `/admin/*`.

## Flujo de subida (no inventar otro)
1. Cliente pide URL con `getUploadUrl()` (`actions/files.ts`): valida **20 MB máx** y genera key con `buildR2Key()` → `comun/...`, `usuarios/<id>/publico/...` o `usuarios/<id>/privado/...`.
2. `PUT` directo a R2 desde `UploadModal.tsx`: **solo** header `Content-Type` y `credentials: 'omit'`. Cualquier header extra rompe la firma.
3. `registrarArchivo()` inserta en `archivos`. El trigger BD rechaza si supera **9 GB** (`get_storage_usage()`); propaga el mensaje `LIMITE_ALMACENAMIENTO`.

## Quirks de R2 (causas reales de bugs pasados)
- `S3Client` lleva `forcePathStyle: true` y `requestChecksumCalculation / responseChecksumValidation: 'WHEN_REQUIRED'` (`lib/r2/client.ts`). No quitar: R2 no soporta los checksums automáticos del SDK AWS.
- Toda URL firmada pasa por `toBrowserSafePresignedUrl()` (codifica path sin tocar el query de firma). No normalizar ni reescribir la URL a mano.
- Expiraciones: subida 300 s, vista/descarga 900 s. Vista = `inline` (`getPresignedViewUrl`), descarga = `attachment; filename="..."` (`getPresignedDownloadUrl`).

## Visualizar vs descargar
- `FileCard.tsx`: visualizar abre `<a target="_blank">` con URL `inline`; descargar usa atributo `download`. No unificar: `/compartir` reutiliza el motor de vista.
- Auditoría: `visualizarArchivo` → `VISUALIZAR_ARCHIVO`, `descargarArchivo` → `DESCARGAR_ARCHIVO`, `generarEnlaceCompartido` → `COMPARTIR_ENLACE`. Todo vía `logActivity()` (`actions/storage.ts`), nunca insert directo desde cliente.

## Caché / PWA (pantallas congeladas en móvil)
- `public/sw.js` (`CACHE_NAME = 'gestor-familiar-v2'`) es **network-first** con fallback a caché solo sin red, y el evento `activate` borra cachés viejas + `clients.claim()`. Solo cachea `/` y `/manifest.json`: **no cachear rutas del dashboard ni URLs firmadas**.
- Al desplegar un cambio que afecte al SW, **sube la versión de `CACHE_NAME`** o los móviles seguirán con la vieja.
- `next.config.ts` inyecta `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` + `Pragma: no-cache` + `Expires: 0` en `/(.*)`. No añadir caché HTTP a vistas dinámicas.

## Fechas e hidratación (error 418 recurrente)
- Usar siempre `<DateDisplay date={...} />` (`components/DateDisplay.tsx`: `suppressHydrationWarning` + `es-ES`). Nunca `new Date(...).toLocaleDateString()` directo en un client component.
- `searchParams` en `app/compartir/page.tsx` es `Promise`: hay que hacer `await`.

## Enviar fuera y Abrir con (PWA bidireccional)
- **Enviar** (barra de selección → `EnviarSeleccionButton.tsx` → `enviarArchivo()` en `actions/files.ts`): Web Share con ficheros (blob vía URL firmada, sin guardar en disco, máx 10 por envío); si el navegador no lo soporta o se cancela, avisa. Auditoría propia: `COMPARTIR_EXTERNO` (distinto de `DESCARGAR_ARCHIVO`). El botón **Copiar** se eliminó: el portapapeles web solo acepta texto/HTML/PNG y fallaba con el resto.
- **Mover en lote** (barra de selección → `MoverSeleccionModal.tsx` → `moverElementosBatch()` en `actions/mover.ts`, máx 50): archivos (entre ámbitos reubica bytes en R2 con `moverEnR2()` + reversión si falla la BD; herencias `publico` solo van al Área común) y carpetas (mismo ámbito + anti-ciclo 50 niveles). Auditoría `MOVER` por elemento; resumen con omitidos/fallidos + "Ir al destino".
- **Abrir con** (File Handling, solo Chromium escritorio): `file_handlers` en `public/manifest.json` → `/abrir` (pública en `middleware.ts`, la sesión se valida dentro como `/recibir`). `AperturaSistema.tsx` consume `launchQueue` y reutiliza `GuardadoManual` (prop `externos`, remonte por `key`).
- Límite conocido: ninguna web puede inyectarse en el diálogo "Abrir archivo" del SO. Puente WebDAV: implementado en `worker/` (Worker Cloudflare + R2 solo-lectura; en Vercel es imposible: `PROPFIND` devuelve 405). Detalle en `docs/diseno-webdav.md`.
- **Worker WebDAV**: deploy separado con `npx wrangler deploy` desde `worker/` (no pasa por Vercel ni `npm run build`; `tsconfig.json` lo excluye, tipos con `npx tsc -p worker/tsconfig.json`). Secretos solo vía `wrangler secret put` (`SUPABASE_SERVICE_ROLE_KEY`); `SUPABASE_URL` en `worker/wrangler.toml`. Tokens de Explorador: `actions/dav.ts` + `/ajustes` + tabla `tokens_dav`. Pruebas: `node worker/test/smoke.mjs <base> <email> <token> [ruta-archivo]`. Guía familiar: `docs/alta-explorador.md`. Escritura (futura): especificada en `docs/diseno-webdav-escritura.md`, no implementar aún.

## Compartir
- `FileListWrapper.tsx` gestiona el modo selección (multi-select archivos + carpetas) y llama a `generarEnlaceCompartido({ archivoIds, carpetaIds })`. Token con `crypto.randomUUID()`, `tipo_recurso` auto (`archivo`/`carpeta`/`multiple`), expiración **7 días**, URL base `NEXT_PUBLIC_APP_URL` (fallback `http://localhost:3000`).
- Límite conocido: `obtenerEnlaceCompartido()` solo resuelve `archivos_ids` (las `carpetas_ids` se guardan y auditan pero no se expanden en `/compartir`). No prometer carpetas navegables en el enlace.
- RLS `enlaces_compartidos`: `SELECT` abierto por token, `INSERT` propio, `DELETE` propio/admin.

## BD y RLS
- `supabase/schema.sql` es el ejecutable de verdad: triggers `handle_new_user`, `trg_registrar_subida`, `trg_cambio_estado_archivo`, `trg_validar_limite` (9 GB). `historial_actividad` es inmutable (UPDATE/DELETE revocados + sin policies de escritura salvo triggers/`logActivity`).
- **RLS es la capa de autorización**: no bypasearla con service-role en código servidor. Borrado normal = `estado='papelera'`; borrado físico solo admin (`eliminarArchivoPermanente`: primero R2, luego BD).
- `buscarArchivos()` escapa `\`, `%`, `_` y limita a 50 resultados; mantener ese escape al tocar la búsqueda.

## Convenciones UI
- Wrappers interactivos con patrón `<Componente>Wrapper.tsx` (`UploadModalWrapper`, `NewFolderModalWrapper`, `FileListWrapper`) para modales/selección bajo padres server.
- Iconos `lucide-react`, fechas `date-fns`, tema oscuro por variables CSS en `app/globals.css`. Nombres largos se truncan con `ellipsis` (ver `FileCard`).

## Entorno
Vars requeridas (ver `.env.example`; R2 solo servidor, sin `NEXT_PUBLIC_`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`
- `NEXT_PUBLIC_APP_URL` (opcional; default `http://localhost:3000` para enlaces de compartir)
