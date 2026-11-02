import pg from 'pg'

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Exécute `fn` dans une transaction annulée à la fin : la base reste intacte. */
export async function inRollback<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query('begin')
    return await fn(client)
  } finally {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
}
