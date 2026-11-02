// Squelette du jeu de départ fictif (local uniquement). Les données s'ajoutent avec les lots suivants.
// Aujourd'hui : fixe app.environment = 'test' sur la base locale, ce que seul un superutilisateur peut faire.
import pg from 'pg'

const url = process.env.SEED_DATABASE_URL ?? 'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres'
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error(`Refus : seed:test ne s'exécute que sur la base locale (hôte reçu : ${host}).`)
  process.exit(1)
}

async function main() {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query("alter database postgres set app.environment = 'test'")
    console.log("Base locale : app.environment = 'test'.")
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
