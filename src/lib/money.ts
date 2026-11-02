const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

/** Formate un montant en centimes (entier, signé) en euros, à la française. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Montant en centimes invalide : ${cents}`)
  return euro.format(cents / 100)
}
