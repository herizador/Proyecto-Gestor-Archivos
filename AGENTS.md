# AGENTS.md — gestor-archivos-familia

## Language Settings
- Siempre debes responder y comunicarte en Español.
- Analiza los prompts en Español y mantén las explicaciones de código en este mismo idioma.

## Commands

```sh
npm run dev      # Next.js dev server
npm run build    # production build
npm run lint     # ESLint (no prettier/biome)
# No test framework installed
```

## Stack & structure

- **Next.js 16 App Router** (React Server Components + Server Actions), **TypeScript 5 strict**, **npm**
- **Supabase** (PostgreSQL + Auth SSR + RLS) for auth & metadata
- **Cloudflare R2** (S3-compatible) for file storage; clients upload directly via presigned URLs
- **PWA** with service worker (`public/sw.js`) + manifest (`public/manifest.json`)
- Path alias `@/*` → root `./*`

## Routing

| Route | Purpose | Auth |
|---|---|---|
| `/login` | Login | public |
| `/` | Common Area (shared files) | required |
| `/familia` | Family directory (per-user public files) | required |
| `/mi-caja-fuerte` | Private files ("My Safe") | required |
| `/papelera` | Trash (soft-deleted files) | required |
| `/admin/historial` | Audit log | admin |
| `/admin/usuarios` | User management | admin |
| `/compartir` | Shared link view (token-based) | public |

## Key conventions

- **Spanish** throughout: UI labels, code comments, SQL identifiers
- Server Actions live in `actions/` (`auth.ts`, `files.ts`, `folders.ts`, `storage.ts`, `share.ts`)
- Supabase clients: `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server, cookie-based)
- R2 helpers in `lib/r2/client.ts`
- Types generated from schema in `types/database.ts`
- Icons: `lucide-react`; dates: `date-fns`
- Interactive wrappers follow `<Component>Wrapper.tsx` pattern (client wrapper for server-parented modals)
- Dark theme: CSS custom properties in `app/globals.css`

## Data flow & quirks

1. **Direct-to-R2 upload**: browser gets presigned URL → uploads directly (bypasses server)
2. **Audit log immutable**: `historial_actividad` has UPDATE/DELETE RLS revoked. Logging via DB triggers + server actions
3. **Soft delete** → `papelera` state; permanent deletion admin-only
4. **RLS is the authz layer** — do not bypass it in server code
5. **9 GB storage cap** enforced via DB function `get_storage_usage()`
6. **DB triggers**: auto-create profile on signup, auto-log uploads and status changes
7. **Middleware** (`middleware.ts`): redirects unauthenticated → `/login`, guards `/admin/*` for admin role, allows `/compartir` publicly
8. **Sharing**: multi-select via `FileListWrapper` → `generarEnlaceCompartido()` generates a token → stored in `enlaces_compartidos` table with 7-day expiry. Public `/compartir?token=xyz` generates presigned URLs at view time
9. **DB table `enlaces_compartidos`**: stores token, typed resource, file/folder ID lists, expiration. RLS: SELECT by token (anyone), INSERT own, DELETE own/admin

## Environment

Required vars (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`
- `NEXT_PUBLIC_BASE_URL` (for share link generation, defaults to `http://localhost:3000`)
