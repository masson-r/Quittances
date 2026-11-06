import { createClient } from '@/lib/supabase/server'
import { relativeRedirect } from '@/lib/relative-redirect'

// Profil désactivé : fin de session forcée (les cookies ne s'écrivent pas depuis un Server Component).
export async function GET() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return relativeRedirect('/connexion?erreur=desactive')
}
