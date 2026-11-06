import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { relativeRedirect } from '@/lib/relative-redirect'

const TYPES = { email: '/espace', recovery: '/mot-de-passe/nouveau' } as const

// Lien des e-mails de confirmation et de réinitialisation : le jeton est échangé côté serveur, puis redirection.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  const target = type === 'email' || type === 'recovery' ? TYPES[type] : null

  if (tokenHash && target && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type: type as keyof typeof TYPES, token_hash: tokenHash })
    if (!error) return relativeRedirect(target)
  }
  return relativeRedirect('/connexion?erreur=lien')
}
