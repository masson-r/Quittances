import { isValidIsoDate } from '@/lib/dates'

export const PERIODS = ['mois', 'trimestre', 'annee', '1an', '2ans', '3ans', '5ans', 'perso'] as const
export type PeriodKey = (typeof PERIODS)[number]

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  mois: 'Mois en cours',
  trimestre: 'Trimestre en cours',
  annee: 'Année en cours',
  '1an': '1 an glissant',
  '2ans': '2 ans glissants',
  '3ans': '3 ans glissants',
  '5ans': '5 ans glissants',
  perso: 'Dates personnalisées',
}

export interface Period {
  key: PeriodKey
  from: string
  to: string
}

const iso = (d: Date): string => d.toISOString().slice(0, 10)
const utc = (value: string): Date => new Date(`${value}T00:00:00Z`)

/** Même jour, `years` ans plus tôt, moins un jour (période glissante qui se termine aujourd'hui, bornes incluses). */
function rollingStart(today: string, years: number): string {
  const d = utc(today)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  d.setUTCDate(d.getUTCDate() + 1)
  return iso(d)
}

/**
 * Période demandée dans l'URL, calculée d'après la date du jour à Paris. Une clé inconnue ou des dates personnalisées
 * invalides (ou inversées) ramènent au mois en cours. Les périodes courantes se terminent à leur dernier jour
 * (le mois entier, pas seulement jusqu'à aujourd'hui) : les échéances à venir du mois comptent dans « appelé ».
 */
export function resolvePeriod(key: string | undefined, today: string, custom?: { from?: string; to?: string }): Period {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const monthEnd = (year: number, month: number) => iso(new Date(Date.UTC(year, month, 0)))
  const pad = (n: number) => String(n).padStart(2, '0')

  switch (key) {
    case 'trimestre': {
      const startMonth = Math.floor((m - 1) / 3) * 3 + 1
      return { key: 'trimestre', from: `${y}-${pad(startMonth)}-01`, to: monthEnd(y, startMonth + 2) }
    }
    case 'annee':
      return { key: 'annee', from: `${y}-01-01`, to: `${y}-12-31` }
    case '1an':
      return { key: '1an', from: rollingStart(today, 1), to: today }
    case '2ans':
      return { key: '2ans', from: rollingStart(today, 2), to: today }
    case '3ans':
      return { key: '3ans', from: rollingStart(today, 3), to: today }
    case '5ans':
      return { key: '5ans', from: rollingStart(today, 5), to: today }
    case 'perso':
      if (custom?.from && custom.to && isValidIsoDate(custom.from) && isValidIsoDate(custom.to) && custom.from <= custom.to) {
        return { key: 'perso', from: custom.from, to: custom.to }
      }
      break
  }
  return { key: 'mois', from: `${y}-${pad(m)}-01`, to: monthEnd(y, m) }
}

/** Plage de l'évolution mensuelle : la période si elle couvre au moins douze mois, sinon les douze mois qui finissent avec elle. */
export function monthlyRange(period: Period): { from: string; to: string } {
  const start = utc(period.from)
  const end = utc(period.to)
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1
  if (months >= 12) return { from: period.from, to: period.to }
  const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  return { from: iso(from), to: period.to }
}

/** Taux d'encaissement en pourcentage entier (encaissé ÷ appelé), null sans loyer appelé. */
export function collectionRate(collectedCents: number, calledCents: number): number | null {
  return calledCents > 0 ? Math.round((collectedCents / calledCents) * 100) : null
}
