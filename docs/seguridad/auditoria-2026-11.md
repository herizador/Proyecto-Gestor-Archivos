# Auditoría de seguridad de archivos — noviembre 2026

Revisión completa de autenticación, RLS, claves de R2, enlaces compartidos, rutas
API, Worker WebDAV, cabeceras y dependencias. El objetivo: que un miembro no
pueda leer, borrar, mover ni publicar archivos de otro, ni saltarse el cupo.

## Resumen

| Capa | Estado |
| --- | --- |
| Server Actions y rutas API | Endurecidas: UUIDs, nombres, MIME, pertenencia de keys y filas afectadas |
| RLS / triggers | Reforzados en `supabase/migraciones/seguridad-2026-11.sql` |
| R2 | Tamaño real verificado, `Content-Length` firmado y sufijo aleatorio en las keys |
| Worker WebDAV | MIME normalizado y tipos activos forzados a descarga |
| Cabeceras | `nosniff`, `X-Frame-Options`, CSP mínima, Referrer-Policy, HSTS |
| Dependencias | `npm audit --omit=dev` → 0 vulnerabilidades |

> **Pendiente de aplicar a mano:** la migración SQL. Hasta ejecutarla en
> Supabase → SQL Editor, las policies nuevas no están activas.

## Hallazgos corregidos

### Críticos

1. **Cualquiera podía listar todos los enlaces compartidos.**
   `enlaces_select_token` usaba `USING (TRUE)`, así que con la anon key se podían
   volcar todos los tokens y abrir archivos ajenos. Ahora solo el creador ve sus
   enlaces y `/compartir` los lee con service-role validando token, expiración,
   UUIDs y que cada archivo sea del creador o de ámbito no privado.

2. **Se podían insertar filas de `archivos` apuntando a keys ajenas.**
   `archivos_insert` solo comprobaba `subido_por`. Ahora exige que `ruta_r2`
   pertenezca al usuario (o al Área común), que la carpeta sea visible y que el
   ámbito de la key concuerde con la privacidad de la carpeta. Un constraint
   `chk_archivos_ruta_r2` valida el formato de la key.

3. **`lotes_recibidos` aceptaba claves R2 arbitrarias.**
   Un lote manipulado podía mover o borrar objetos de otra persona. Ahora un
   trigger exige `compartidos-pendientes/<uid>/<archivo>` y las acciones vuelven
   a comprobar la pertenencia antes de tocar R2.

4. **El tamaño real no se verificaba.**
   Se registraba el tamaño declarado por el cliente. Ahora `registrarArchivo()`
   hace `HeadObject` y usa el tamaño real (y descarta el objeto si supera 20 MB).
   La URL de subida firma `Content-Length`, así que R2 rechaza un cuerpo mayor.

### Altos

5. **Contenido activo servido inline.**
   HTML, SVG, XML y JavaScript se servían como `inline` desde R2. Ahora solo se
   muestran en línea imágenes (sin SVG), PDF, texto/CSV/JSON, audio y vídeo; el
   resto se fuerza como `attachment` binario. Aplicado en `lib/r2/client.ts` y en
   el Worker (`worker/src/util.ts`, `worker/src/lectura.ts`).

6. **El admin podía ver y modificar la Caja fuerte ajena.**
   Las policies daban bypass de admin en SELECT/UPDATE/DELETE. Ahora el admin
   solo actúa sobre contenido no privado; la Caja fuerte queda privada también
   para él. Aplicado en RLS, en mover, compartir, enlaces y accesos directos.

7. **El dueño no podía borrar definitivamente su archivo.**
   `archivos_delete` era solo para admin. Ahora el dueño puede borrar lo suyo y
   el admin lo no privado.

8. **Auditoría falsificable.**
   Cualquier usuario autenticado podía insertar filas en `historial_actividad`.
   Ahora se escribe solo por la RPC `registrar_actividad()` y por triggers; el
   `INSERT` directo está revocado para `authenticated` y `anon`.

9. **Open redirect en `/auth/confirm`.**
   `next` aceptaba `//host`, `/\host` y caracteres de control. Ahora solo rutas
   internas.

10. **Enlaces directos que publicaban contenido privado.**
    Se podía enlazar un archivo privado en una carpeta pública. Ahora un elemento
    privado solo se enlaza en una carpeta privada propia, y no se escribe dentro
    de carpetas privadas ajenas (RLS + server action).

### Medios

11. **Privacidad heredada en carpetas.**
    Una subcarpeta pública dentro de una privada exponía su contenido. Ahora un
    trigger fuerza `es_privada = TRUE` cuando el padre es privado, y el servidor
    aplica la misma regla antes de insertar.

12. **Nombres y MIME sin sanear.**
    Se guardaban tal cual (cabeceras y UI). Ahora se quitan rutas, caracteres de
    control y comillas, se limita la longitud y se normaliza el MIME.

13. **Keys adivinables.**
    Las keys nuevas llevan un sufijo `randomUUID().slice(0, 8)`.

14. **Consultas sin comprobar filas afectadas.**
    Renombrar, mover, borrar, favoritos, recordatorios y tokens DAV comprueban
    ahora que la operación afectó a una fila (RLS silenciosa ya no pasa).

15. **Errores que filtraban detalles.**
    Login, invitación y operaciones de archivos devuelven mensajes genéricos.

## Comportamiento nuevo visible

- Los archivos HTML/SVG/XML/JS se **descargan** en lugar de abrirse en el
  navegador. Es intencionado: evita ejecutar contenido subido por un miembro.
- Una carpeta creada dentro de una privada aparece siempre como privada.
- Un archivo privado no se puede enlazar en una carpeta pública.
- El admin no puede abrir, mover, renombrar ni borrar la Caja fuerte de otro.

## Checklist operativa (fuera del código)

1. **Aplicar la migración** `supabase/migraciones/seguridad-2026-11.sql` en
   Supabase → SQL Editor. Es idempotente.
2. **Bucket R2 privado**: sin acceso público; todo va por URL firmada.
3. **CORS de R2 restringido** al dominio de la app (no `*`).
4. **Revocar el token WebDAV** que se expuso en un chat y rotar credenciales si
   hubo duda.
5. **MFA en la cuenta admin** de Supabase y contraseña única.
6. **Copias de seguridad**: activar versionado/lifecycle en R2 o copia local
   (rclone) y revisar objetos huérfanos.
7. **Límites de abuso**: considerar rate limit en `/api/recibir` y `/api/subir`
   (Vercel Firewall o Cloudflare) si se abre a internet.
8. **Revisar el historial** de auditoría tras aplicar la migración para detectar
   actividad anómala previa.

## Verificaciones ejecutadas

```sh
npx tsc --noEmit
npm run lint
npm run build
npx tsc -p worker/tsconfig.json
npm audit --omit=dev   # 0 vulnerabilidades
```

Quedan 16 avisos moderados de dependencias **de desarrollo** (`minimatch` vía
ESLint); `npm audit fix --force` instalaría `eslint@4` y rompería el lint, así
que no se aplica.

## Archivos clave

- `lib/archivos-seguros.ts`: saneado, MIME, UUIDs y pertenencia de keys.
- `lib/r2/client.ts`: firmas, `ContentLength`, `HeadObject` y keys con sufijo.
- `actions/files.ts`, `share.ts`, `recibir.ts`, `mover.ts`, `folders.ts`,
  `accesos.ts`, `compartir-usuarios.ts`, `favoritos.ts`, `recordatorios.ts`,
  `dav.ts`: validación en servidor.
- `app/api/subir/route.ts`, `app/api/recibir/route.ts`,
  `app/auth/confirm/route.ts`: rutas endurecidas.
- `worker/src/util.ts`, `worker/src/lectura.ts`: MIME y descarga segura.
- `next.config.ts`: cabeceras de seguridad.
- `supabase/schema.sql` y `supabase/migraciones/seguridad-2026-11.sql`: RLS,
  triggers y auditoría.
