# Incidencias de R2: bloqueo de LaLiga, CORS y certificados

Guía para no confundir un fallo de la app con un bloqueo de red.

## Síntomas y causa

| Lo que ves | Qué es en realidad |
| --- | --- |
| `net::ERR_CERT_AUTHORITY_INVALID` en `*.r2.cloudflarestorage.com` | El ISP intercepta la conexión y presenta un certificado que no es de Cloudflare. |
| `No 'Access-Control-Allow-Origin' header is present` en el `PUT` | La respuesta no viene de R2, sino de la página de bloqueo (que no pone cabeceras CORS). |
| `Failed to fetch` al subir | El `PUT` a R2 no llega a destino: conexión cortada o página de bloqueo. |
| Al abrir un archivo aparece la nota de la **Sentencia de 18/12/2024 (Juzgado Mercantil nº 6 de Barcelona)** | Página de bloqueo de LaLiga servida en lugar del archivo. |
| `503` en `/todos` | Fallo puntual de Vercel (despliegue o plataforma). No está relacionado con R2. |

**Causa habitual:** LaLiga solicita a los operadores españoles bloquear un conjunto reducido de IPs de Cloudflare durante las jornadas. R2 vive en esas IPs, así que la app deja de poder firmar, subir y ver archivos aunque el código esté perfecto. El bloqueo suele ser **temporal** (ventana de partidos) y afecta solo a algunas redes.

## Diagnóstico en 10 segundos

```sh
npm run r2:diagnostico
```

Salida que confirma el bloqueo:

```
── configurado: https://<cuenta>.r2.cloudflarestorage.com
   red:  HTTP 200 · Server: nginx · text/html
   ⚠️  Eso NO es R2: es una página de bloqueo (LaLiga/ISP).
   auth: sin respuesta de R2 (TimeoutError…)
```

R2 de verdad responde `Server: cloudflare` y `Content-Type: application/xml`. Si ves `Server: nginx` con HTML, no estás hablando con el almacenamiento.

Para probar también la variante EU (otras IPs de Cloudflare):

```sh
node --env-file=.env.local scripts/r2.mjs diagnostico --escritura
```

> El endpoint EU (`<cuenta>.eu.r2.cloudflarestorage.com`, IPs `141.101.90.x`) solo sirve buckets creados con jurisdicción EU. Un bucket normal responde `AccessDenied`; no es una salida sin migrar el bucket.

## Qué hacer

1. **Ahora:** esperar a que termine la jornada, usar datos móviles u otra red, o una VPN. No es un bug de la app.
2. **Comprobar si el archivo se subió:** si el `PUT` falló, no se registró nada. Si llegó a R2 pero falló `registrarArchivo`, el objeto queda huérfano; no lo subas otra vez a ciegas, revisa la lista antes.
3. **No tocar CORS por esto:** el `PUT` no falla por la política del bucket. Verifícala aparte:

   ```sh
   npm run r2:cors        # muestra la política real
   npm run r2:cors -- --aplicar
   ```

## Salidas estructurales (si el bloqueo se repite)

Ordenadas de menos a más trabajo:

- **Dominio propio conectado al bucket R2.** Cambia las IPs que resuelve el navegador. No garantiza nada (siguen siendo Cloudflare), pero puede caer fuera del conjunto bloqueado. Requiere dominio y configurar `CLOUDFLARE_R2_ENDPOINT` con ese host.
- **Worker en `*.workers.dev` con binding a R2 y tokens HMAC.** Sustituye las URLs prefirmadas por un endpoint propio. Es la solución más robusta sin cambiar de proveedor, pero hay que rehacer firma, caducidad y CORS.
- **Bucket en jurisdicción EU.** Usaría el endpoint EU, que hoy no está bloqueado. R2 no permite cambiar la jurisdicción: habría que crear otro bucket y copiar los datos.
- **Cambiar de proveedor** (Supabase Storage, Backblaze B2, AWS S3). Migración grande; solo si el bloqueo es inaceptable.

## Comprobar la configuración CORS

La política necesaria está en el [README (puesta en marcha)](../../README.md#puesta-en-marcha) y se puede aplicar con `npm run r2:cors -- --aplicar`. Orígenes: `http://localhost:3000`, el dominio de producción y `NEXT_PUBLIC_APP_URL` si es válido.

> `NEXT_PUBLIC_APP_URL` debe ser el dominio real (`https://proyecto-gestor-archivos.vercel.app`). Si vale `https://vercel.app`, los enlaces de compartir apuntan a un dominio que no es la app.
