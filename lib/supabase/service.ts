import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Cliente con service-role (bypasea RLS): solo para operaciones del servidor
// que no pueden ir con sesión de usuario (reclamos de invitación, /api/subir).
// Requiere SUPABASE_SERVICE_ROLE_KEY (solo servidor, también en Vercel).
export function crearServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient<Database>(url, serviceKey, { auth: { persistSession: false } })
}
