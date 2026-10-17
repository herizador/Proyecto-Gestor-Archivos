import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

// `sesionTemporal: true` = el usuario NO marcó "Recordar este dispositivo".
// En ese caso las cookies de sesión se emiten SIN caducidad (cookie de sesión):
// el navegador las borra al cerrarse. El valor y los nombres no cambian.
export async function createClient(
  { sesionTemporal = false }: { sesionTemporal?: boolean } = {}
) {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                sesionTemporal ? { ...options, maxAge: undefined, expires: undefined } : options
              )
            )
          } catch {
            // setAll llamado desde un Server Component — ignorar
          }
        },
      },
    }
  )
}
