// Règles financières pures (ticket 003) : aucune dépendance à la base ni à l'horloge.
// Montants en centimes entiers ; dates au format AAAA-MM-JJ (jours calendaires, fuseau de Paris côté appelant).

export type IsoDate = string
export interface Period {
  year: number
  /** 1 à 12 */
  month: number
}

export const CASH_WARNING_CENTS = 100_000

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (year: number, month: number, day: number): IsoDate => `${year}-${pad(month)}-${pad(day)}`
const dayOf = (date: IsoDate) => Number(date.slice(8, 10))
const monthIndex = (year: number, month: number) => year * 12 + (month - 1)

export const periodKey = (p: Period): string => `${p.year}-${pad(p.month)}`

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Date d'échéance de la période : jour d'échéance du bail (ramené au dernier jour du mois pour les jours 29 à 31),
 * bornée à la période d'occupation (première échéance à la date de début, dernière à la date de fin).
 */
export function dueDateFor(period: Period, dueDay: number, start: IsoDate, end: IsoDate | null): IsoDate {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new RangeError(`Jour d'échéance invalide : ${dueDay}`)
  const nominal = iso(period.year, period.month, Math.min(dueDay, daysInMonth(period.year, period.month)))
  if (nominal < start) return start
  if (end !== null && nominal > end) return end
  return nominal
}

/** Nombre de jours d'occupation dans la période (bornes incluses), zéro hors de la période d'occupation. */
export function occupiedDays(period: Period, start: IsoDate, end: IsoDate | null): number {
  const first = iso(period.year, period.month, 1)
  const last = iso(period.year, period.month, daysInMonth(period.year, period.month))
  const from = start > first ? start : first
  const to = end !== null && end < last ? end : last
  return from > to ? 0 : dayOf(to) - dayOf(from) + 1
}

/** Montant mensuel × jours occupés ÷ jours du mois, arrondi au centime le plus proche (la moitié vers le haut). */
export function prorata(monthlyCents: number, occupied: number, monthDays: number): number {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0) throw new RangeError(`Montant mensuel invalide : ${monthlyCents}`)
  if (!Number.isInteger(monthDays) || monthDays < 1) throw new RangeError(`Nombre de jours du mois invalide : ${monthDays}`)
  if (!Number.isInteger(occupied) || occupied < 0 || occupied > monthDays) throw new RangeError(`Jours occupés invalides : ${occupied}`)
  return Math.floor((2 * monthlyCents * occupied + monthDays) / (2 * monthDays))
}

/** Loyer et charges arrondis séparément ; le total est leur somme. */
export function chargeAmounts(rentCents: number, chargesCents: number, occupied: number, monthDays: number) {
  const rent = prorata(rentCents, occupied, monthDays)
  const charges = prorata(chargesCents, occupied, monthDays)
  return { rentCents: rent, chargesCents: charges, totalCents: rent + charges }
}

export interface RentTerm {
  effectiveFrom: IsoDate
  rentCents: number
  chargesCents: number
}

/**
 * Conditions applicables à la période : la plus récente version dont la date d'effet n'est pas postérieure au début de
 * la période (le début d'un bail en cours de mois compte comme début de sa première période). Une version ne découpe jamais
 * une période.
 */
export function termForPeriod(terms: readonly RentTerm[], period: Period, leaseStart: IsoDate): RentTerm | undefined {
  const first = iso(period.year, period.month, 1)
  const periodStart = leaseStart > first ? leaseStart : first
  let found: RentTerm | undefined
  for (const term of terms) {
    if (term.effectiveFrom <= periodStart && (found === undefined || term.effectiveFrom > found.effectiveFrom)) found = term
  }
  return found
}

export type RentChargeStatus = 'to_pay' | 'partially_paid' | 'paid' | 'late'

/** Statut calculé, jamais stocké : payée si le solde est nul ; en retard dès le lendemain de l'échéance ; sinon selon les affectations. */
export function computeStatus(input: { totalCents: number; allocatedCents: number; dueDate: IsoDate; today: IsoDate }): RentChargeStatus {
  const { totalCents, allocatedCents, dueDate, today } = input
  if (allocatedCents < 0 || allocatedCents > totalCents) throw new RangeError('Affectations incohérentes avec le total de l\'échéance')
  if (allocatedCents === totalCents) return 'paid'
  if (today > dueDate) return 'late'
  return allocatedCents > 0 ? 'partially_paid' : 'to_pay'
}

export interface DuePeriod {
  key: string
  year: number
  month: number
  dueDate: IsoDate
  occupiedDays: number
  daysInMonth: number
}

/**
 * Périodes dont l'échéance est atteinte à la date `today` : pas de génération à l'avance, rattrapage complet pour un bail
 * commencé dans le passé. Ordre chronologique.
 */
export function periodsDue(input: { start: IsoDate; end: IsoDate | null; dueDay: number; today: IsoDate }): DuePeriod[] {
  const { start, end, dueDay, today } = input
  const limit = end !== null && end < today ? end : today
  const firstIndex = monthIndex(Number(start.slice(0, 4)), Number(start.slice(5, 7)))
  const lastIndex = monthIndex(Number(limit.slice(0, 4)), Number(limit.slice(5, 7)))

  const result: DuePeriod[] = []
  for (let index = firstIndex; index <= lastIndex; index++) {
    const period = { year: Math.floor(index / 12), month: (index % 12) + 1 }
    const dueDate = dueDateFor(period, dueDay, start, end)
    if (dueDate > today) continue
    result.push({
      key: periodKey(period),
      ...period,
      dueDate,
      occupiedDays: occupiedDays(period, start, end),
      daysInMonth: daysInMonth(period.year, period.month),
    })
  }
  return result
}

export interface OpenCharge {
  id: string
  dueDate: IsoDate
  balanceCents: number
}

/** Proposition d'affectation de la plus ancienne à la plus récente échéance, sans dépasser aucun solde ; le reste n'est pas affecté. */
export function proposeAllocation(paymentCents: number, charges: readonly OpenCharge[]) {
  if (!Number.isSafeInteger(paymentCents) || paymentCents <= 0) throw new RangeError(`Montant du paiement invalide : ${paymentCents}`)
  const ordered = [...charges].sort((a, b) => (a.dueDate === b.dueDate ? (a.id < b.id ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1))

  let remaining = paymentCents
  const allocations: { chargeId: string; amountCents: number }[] = []
  for (const charge of ordered) {
    if (remaining === 0) break
    if (charge.balanceCents <= 0) continue
    const amountCents = Math.min(remaining, charge.balanceCents)
    allocations.push({ chargeId: charge.id, amountCents })
    remaining -= amountCents
  }
  return { allocations, unallocatedCents: remaining }
}

export type PaymentMode = 'transfer' | 'cheque' | 'cash' | 'other'

/** Avertissement non bloquant : espèces à partir de 1 000 €. */
export function needsCashWarning(mode: PaymentMode, amountCents: number): boolean {
  return mode === 'cash' && amountCents >= CASH_WARNING_CENTS
}
