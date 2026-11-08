const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

/** Formate un montant en centimes (entier, signé) en euros, à la française. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Montant en centimes invalide : ${cents}`)
  return euro.format(cents / 100)
}

/**
 * Lit un montant saisi en euros (« 850 », « 850,5 », « 1 250,00 », « 850.50 ») et le renvoie en centimes.
 * Renvoie null si la saisie n'est pas un montant positif ou nul avec deux décimales au plus (plafond : 999 999,99 €).
 */
export function parseEuros(input: string): number | null {
  const text = input.replace(/\s/g, '')
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text)
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return cents <= 99_999_999 ? cents : null
}
