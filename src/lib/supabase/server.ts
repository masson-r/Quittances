import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseEnv } from './env'

/** Client Supabase au nom de l'utilisateur connecté (clé publique, RLS appliquée). */
export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = supabaseEnv()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Appel depuis un Server Component : le proxy rafraîchit déjà la session.
        }
      },
    },
  })
}
