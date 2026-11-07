import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface CurrentUser {
  id: string
  email: string
  firstName: string
  lastName: string
}

export interface SessionOptions {
  /** Pages de sécurité : accessibles avant d'avoir validé le second facteur. */
  allowMfaPending?: boolean
}

/**
 * Utilisateur connecté, relu en base à chaque appel : session valide côté serveur d'authentification
 * ET profil actif. Renvoie null sans session ; redirige vers la déconnexion forcée si le profil est désactivé.
 * Aucune mise en cache : une désactivation s'applique à la requête suivante.
 */
export async function getCurrentUser(options: SessionOptions = {}): Promise<CurrentUser | null> {
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

  if (!options.allowMfaPending) await enforceSecondFactor(supabase, user.id)

  return { id: user.id, email: profile.email, firstName: profile.first_name, lastName: profile.last_name }
}

/**
 * Administrateur et gestionnaire doivent avoir validé leur second facteur (session aal2).
 * La base applique la même règle dans has_permission ; ce contrôle ne fait que guider l'utilisateur.
 */
async function enforceSecondFactor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: memberships } = await supabase
    .from('entity_memberships')
    .select('role')
    .eq('profile_id', userId)
    .eq('status', 'active')
  const required = (memberships ?? []).some((m) => m.role === 'administrator' || m.role === 'manager')
  if (!required) return

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assurance?.currentLevel === 'aal2') return

  // listFactors interroge le serveur : un facteur supprimé (code de secours) n'est plus compté.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  redirect(factors && factors.totp.length > 0 ? '/securite/verification' : '/securite/activation')
}

/** À appeler en tête de chaque page protégée et de chaque Server Action. */
export async function requireUser(options: SessionOptions = {}): Promise<CurrentUser> {
  const user = await getCurrentUser(options)
  if (!user) redirect('/connexion')
  return user
}
