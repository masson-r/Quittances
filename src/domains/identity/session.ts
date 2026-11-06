import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface CurrentUser {
  id: string
  email: string
  firstName: string
  lastName: string
}

/**
 * Utilisateur connecté, relu en base à chaque appel : session valide côté serveur d'authentification
 * ET profil actif. Renvoie null sans session ; redirige vers la déconnexion forcée si le profil est désactivé.
 * Aucune mise en cache : une désactivation s'applique à la requête suivante.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, first_name, last_name, status')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || profile.status !== 'active') redirect('/auth/desactive')

  return { id: user.id, email: profile.email, firstName: profile.first_name, lastName: profile.last_name }
}

/** À appeler en tête de chaque page protégée et de chaque Server Action. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/connexion')
  return user
}
