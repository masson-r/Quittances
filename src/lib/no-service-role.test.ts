import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

// La clé service_role reste hors de l'application : outil de l'opérateur (scripts/operator) uniquement.
// Les modules serveur isolés prévus plus tard (consommation des invitations, liens de téléchargement)
// s'ajoutent explicitement à cette liste, avec leur ticket.
const ALLOWED: string[] = ['src/lib/storage/private-buckets.ts']
const FORBIDDEN = /service_role|SUPABASE_SECRET_KEY|sb_secret_/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : []
  })
}

describe('clé service_role', () => {
  it('n\'apparaît nulle part dans le code de l\'application', () => {
    const offenders = sources('src')
      .filter((f) => !f.endsWith('no-service-role.test.ts'))
      .filter((f) => !ALLOWED.includes(f.split(sep).join('/')))
      .filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
