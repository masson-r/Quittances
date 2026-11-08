import { parseEuros } from './money'

/**
 * Montant signé saisi en euros : « 120,50 » (positif), « -80 » ou « −80 » (négatif).
 * Renvoie null si la saisie n'est pas un montant valide.
 */
export function parseSignedEuros(input: string): number | null {
  const text = input.trim().replace(/^[−–]/, '-')
  if (text.startsWith('-')) {
    const cents = parseEuros(text.slice(1))
    return cents === null ? null : cents === 0 ? 0 : -cents
  }
  return parseEuros(text.startsWith('+') ? text.slice(1) : text)
}
