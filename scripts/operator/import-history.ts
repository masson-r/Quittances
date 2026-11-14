// Outil de l'opérateur : reprise d'historique de location depuis des fichiers CSV (voir docs/exploitation/reprise-historique.md).
// Tourne depuis le poste de l'opérateur avec la clé service_role, jamais dans l'application. Les fichiers contiennent des
// données personnelles : ils restent sur ce poste, hors du dépôt et de la CI ; seuls des décomptes et des montants sont imprimés.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { ALL_FILES, USAGE, UsageError, buildPayload, formatReport, parseArgs, type Report } from './import-history-lib'

function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

async function main() {
  try {
    process.loadEnvFile('.env.operator')
  } catch {
    // Pas de fichier : on s'appuie sur les variables d'environnement.
  }
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) throw new UsageError('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY doivent être définies (fichier .env.operator).')
  if (!isLocal(url) && !args.yes && !args.dryRun) {
    throw new UsageError(`La base visée est distante (${new URL(url).host}). Relancez avec --oui pour confirmer.`)
  }
  const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  if (args.cancel) {
    const { data, error } = await supabase.rpc('cancel_import_batch', { p_batch_id: args.cancel, p_reason: args.reason })
    if (error) throw new Error(`L'annulation a échoué : ${error.message}`)
    const c = data as Record<string, number>
    console.log(`Lot annulé : ${c.payments} paiements, ${c.charges} échéances, ${c.expenses} dépenses, ${c.settlements} apurements, ${c.allocations} affectations retirées.`)
    return
  }

  const folder = args.folder as string
  const files: Record<string, string> = {}
  const hash = createHash('sha256')
  for (const name of ALL_FILES) {
    const path = join(folder, `${name}.csv`)
    if (!existsSync(path)) continue
    const bytes = readFileSync(path)
    files[name] = bytes.toString('utf8')
    hash.update(`${name}\n`).update(bytes).update('\n')
  }

  const { payload, errors } = buildPayload(files)
  if (errors.length > 0) {
    // Erreurs de format : rien n'est envoyé à la base.
    console.log(formatReport({ status: 'rejected', errors, counts: {}, totals: [], unpaid: [], imposed_differences: [] }))
    process.exit(1)
  }

  const { data, error } = await supabase.rpc('import_history', {
    p_entity_id: args.structure,
    p_payload: payload,
    p_files_sha256: hash.digest('hex'),
    p_dry_run: args.dryRun,
  })
  if (error) throw new Error(`L'import a échoué : ${error.message}`)
  const report = data as Report
  console.log(formatReport(report))
  if (report.status === 'rejected') process.exit(1)
}

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${USAGE}`)
    process.exit(2)
  }
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
