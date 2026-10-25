# Scripts

## `r2.mjs`

Diagnóstico de Cloudflare R2 con las credenciales del proyecto (lee `.env.local`).

```sh
npm run r2:diagnostico                 # sonda TLS + HeadBucket + CORS
npm run r2:diagnostico -- --escritura  # además sube/lee/borra un objeto temporal
npm run r2:cors                        # muestra la política CORS aplicada
npm run r2:cors -- --aplicar           # escribe la política
```

Añade `--eu` para usar `<cuenta>.eu.r2.cloudflarestorage.com` (solo sirve para buckets de jurisdicción EU).

La sonda TLS distingue a quién estás hablando de verdad:

- `Server: cloudflare` + `application/xml` → R2.
- `Server: nginx` + `text/html` → página de bloqueo del ISP/LaLiga, no es R2.

Contexto y qué hacer en [`docs/guias/incidencias-r2.md`](../docs/guias/incidencias-r2.md).
