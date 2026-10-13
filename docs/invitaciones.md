# Invitar por email: contraseña al primer clic + correo profesional

El enlace de invitación de Supabase autentica pero **nunca pide contraseña**
(así funciona por diseño). Además, un enlace que por sí solo da acceso es
inseguro si se reenvía. Por eso la app usa **reclamos de un solo uso**:
`/auth/confirm` canjea el token, **cierra la sesión de inmediato** y emite un
reclamo (cookie HttpOnly, 30 min, tabla `invitaciones_pendientes`) que solo
autoriza a definir la contraseña en `/establecer-password`. Sin contraseña
demostrada no hay sesión ni navegación posible. Lo que hay que configurar está
en el dashboard de Supabase, no en código.

## 1. URLs (una vez)

Authentication → **URL Configuration**:
- **Site URL**: tu dominio de producción (`https://tu-app.vercel.app`).
- **Additional Redirect URLs**: añade `https://tu-app.vercel.app/auth/confirm`
  y para local `http://localhost:3000/auth/confirm`.

Sin esto los botones del email apuntan a localhost o los bloquea Supabase.

## 2. Plantilla de invitación (una vez)

Authentication → **Emails** (apartado *NOTIFICATIONS* del menú) → plantilla
**Invite user** → pega este asunto y cuerpo (compatible con Gmail/Outlook/iPhone):

- Asunto: `Te han invitado a Archivo Familiar`
- Cuerpo (sustituye `https://tu-app.vercel.app` por tu dominio):

```html
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;border-radius:16px;padding:32px">
  <h1 style="font-size:20px;margin:0 0 8px">Te han invitado a Archivo Familiar</h1>
  <p style="font-size:14px;color:#94a3b8">Tu familia centraliza aquí sus documentos importantes, en privado y sin líos.</p>
  <p style="font-size:14px">Pulsa el botón para activar tu cuenta y crear tu contraseña:</p>
  <p style="text-align:center;margin:24px 0">
    <a href="https://tu-app.vercel.app/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/establecer-password"
       style="display:inline-block;background:#4f8ef7;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 32px;border-radius:10px">Activar mi cuenta</a>
  </p>
  <p style="font-size:12px;color:#64748b">Si el botón no funciona, copia este enlace en tu navegador:<br>
  https://tu-app.vercel.app/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/establecer-password</p>
  <p style="font-size:12px;color:#64748b">Si no esperabas este correo, ignóralo.</p>
</div>
```

Claves: el enlace lleva `type=invite` y `next=/establecer-password` (sin el
`next`, el invitado entraría sin haber creado contraseña).

## 3. Correo profesional con tu dominio (una vez)

Por defecto los correos llegan desde `noreply@mail.app.supabase.io`. Para que
lleguen desde p. ej. `hola@tudominio.com`:

1. Crea cuenta en un proveedor SMTP (p. ej. **Resend**) y **verifica tu dominio**
   con los registros DNS que te pida (SPF/DKIM, 10 min).
2. Genera una **API key** / credencial SMTP.
3. En Supabase: Project Settings → **Auth** → baja a **SMTP Settings** →
   activa *Enable custom SMTP* y rellena host, puerto (465 o 587), usuario,
   contraseña, email remitente (`hola@tudominio.com`) y nombre (`Archivo Familiar`).
4. Guarda y envíate una invitación de prueba: debe llegar desde tu dominio.

## 4. Invitar (cada vez)

Authentication → **Users** → **Invite user** → email → Send. El invitado recibe
el correo del paso 2/3, pulsa el botón, crea su contraseña y entra. Si pierde el
enlace (un solo uso, 30 min) o lo reenvía a otra persona, no sirve para navegar:
solo autoriza a fijar la contraseña de esa cuenta. Se invita de nuevo cuando haga falta.

## 5. Si cambias el esquema (solo la primera vez)

La tabla `invitaciones_pendientes` también está en `supabase/schema.sql`, pero
como tu BD ya existe, aplícala una vez en SQL Editor:

```sql
create table if not exists public.invitaciones_pendientes (
  id             uuid primary key default uuid_generate_v4(),
  usuario_id     uuid not null references public.perfiles(id) on delete cascade,
  token_hash     text not null unique,
  usada          boolean not null default false,
  expira         timestamptz not null,
  fecha_creacion timestamptz not null default now()
);
create index if not exists idx_invitaciones_pendientes_usuario on public.invitaciones_pendientes(usuario_id);
alter table public.invitaciones_pendientes enable row level security;
-- Sin policies a propósito: solo service-role (el navegador nunca la toca).
```
