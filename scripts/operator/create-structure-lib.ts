export class UsageError extends Error {}

export const USAGE = `Usage : pnpm operator:create-structure --nom "<nom>" --genre <personne-physique|sci|autre> --admin <e-mail> [--oui]

  --nom     nom de la structure propriétaire
  --genre   personne-physique, sci ou autre
  --admin   adresse e-mail du premier administrateur (il recevra un lien privé de 14 jours)
  --oui     confirme l'exécution sur une base distante (staging ou production)`

const KINDS: Record<string, string> = { 'personne-physique': 'natural_person', sci: 'sci', autre: 'other' }
const FLAGS = new Set(['--nom', '--genre', '--admin'])

export interface CreateStructureArgs {
  name: string
  kind: string
  adminEmail: string
  yes: boolean
}

export function parseArgs(argv: string[]): CreateStructureArgs {
  const values: Record<string, string> = {}
  let yes = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--oui') yes = true
    else if (FLAGS.has(arg)) values[arg] = argv[++i] ?? ''
    else throw new UsageError(`Option inconnue : ${arg}`)
  }

  const name = (values['--nom'] ?? '').trim()
  if (!name) throw new UsageError('--nom est obligatoire.')
  if (!values['--genre']) throw new UsageError('--genre est obligatoire.')
  const kind = KINDS[values['--genre']]
  if (!kind) throw new UsageError(`Genre inconnu : ${values['--genre']} (personne-physique, sci ou autre).`)
  if (!values['--admin']) throw new UsageError('--admin est obligatoire.')
  const adminEmail = values['--admin'].trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new UsageError(`Adresse e-mail invalide : ${values['--admin']}`)

  return { name, kind, adminEmail, yes }
}

export function buildInvitationLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invitation/${token}`
}

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}
