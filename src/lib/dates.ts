/** Vrai pour une date de calendrier valide au format AAAA-MM-JJ (1900 à 2200). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2200-12-31'
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function todayInParis(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return parts
}

const longDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' })

/** « 5 mars 2026 » à partir d'une date AAAA-MM-JJ. */
export function formatDateFr(iso: string): string {
  return longDate.format(new Date(`${iso}T12:00:00Z`))
}
