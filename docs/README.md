# Documentación

Guías de uso y documentos de diseño del Gestor Familiar. El esquema completo de la base de datos vive en [`../supabase/schema.sql`](../supabase/schema.sql).

## Guías de uso

- [Alta en el Explorador (WebDAV)](guias/alta-explorador.md): crear un token y montar los archivos en el explorador del sistema.
- [Atajo de iOS](guias/atajo-ios.md): subir archivos contra `/api/subir` con un token de Explorador.
- [Invitaciones](guias/invitaciones.md): flujo de invitación, reclamo de un solo uso y SMTP propio.

## Diseño técnico

- [Compartidos con miembros](diseno/compartidos.md): cesiones nominales y herencia de permisos en carpetas.
- [Puente WebDAV](diseno/webdav.md): Worker de Cloudflare de solo lectura sobre R2.
- [Escritura WebDAV](diseno/webdav-escritura.md): especificación futura, aún no implementada.

## Referencia interna

- [`../AGENTS.md`](../AGENTS.md): convenciones del proyecto, arquitectura y decisiones de implementación.
