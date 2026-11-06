import pg from 'pg'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Exécute une requête en propriétaire de la base locale (action de l'opérateur dans les tests). */
export async function operatorQuery(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: URL })
  await client.connect()
  try {
    return await client.query(sql, params)
  } finally {
    await client.end()
  }
}
