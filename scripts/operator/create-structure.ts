// Outil de l'opérateur : crée une structure propriétaire et invite son premier administrateur.
// Tourne depuis le poste de l'opérateur avec la clé service_role, jamais dans l'application.
// Configuration : fichier .env.operator (hors dépôt) ou variables d'environnement, voir docs/exploitation/operateur.md.
import { createClient } from '@supabase/supabase-js'
import { USAGE, UsageError, buildInvitationLink, isLocalUrl, parseArgs } from './create-structure-lib'

async function main() {
  try {
    process.loadEnvFile('.env.operator')
  } catch {
    // Pas de fichier : on s'appuie sur les variables d'environnement.
  }

  const args = parseArgs(process.argv.slice(2))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  const appUrl = process.env.APP_URL
  if (!url || !secret || !appUrl) {
    throw new UsageError('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY et APP_URL doivent être définies (fichier .env.operator).')
  }
  if (!isLocalUrl(url) && !args.yes) {
    throw new UsageError(`La base visée est distante (${new URL(url).host}). Relancez avec --oui pour confirmer.`)
  }

  const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase
    .rpc('create_structure', { p_name: args.name, p_kind: args.kind, p_admin_email: args.adminEmail })
    .single()
  if (error || !data) throw new Error(`La création a échoué : ${error?.message ?? 'réponse vide'}`)

  const { entity_id, token, expires_at } = data as { entity_id: string; token: string; expires_at: string }
  console.log(`Structure créée : ${args.name} (${entity_id})`)
  console.log(`Premier administrateur invité : ${args.adminEmail}`)
  console.log(`Lien valable jusqu'au ${new Date(expires_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (usage unique, à transmettre à cette personne seulement) :`)
  console.log(buildInvitationLink(appUrl, token))
  console.log('Ce lien ne sera plus affiché. En cas de perte, créez une nouvelle invitation.')
}

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${USAGE}`)
    process.exit(2)
  }
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
