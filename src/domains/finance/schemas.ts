import { z } from 'zod'
import { CASH_WARNING_CENTS } from './rules'
import { parseEuros } from '@/lib/money'
import { eurosRequired, requiredDate, uuidField } from '@/lib/zod-fields'
import { optionalText } from '@/lib/form-state'

export const PAYMENT_MODES = ['transfer', 'cheque', 'cash', 'other'] as const
export const PAYMENT_MODE_LABELS: Record<(typeof PAYMENT_MODES)[number], string> = {
  transfer: 'Virement',
  cheque: 'Chèque',
  cash: 'Espèces',
  other: 'Autre',
}

const mode = z.enum(PAYMENT_MODES, { error: 'Choisissez un mode de paiement.' })

/** Affectation saisie : vide ou nulle = ignorée ; illisible = erreur. */
const allocation = z
  .object({ rentChargeId: uuidField('Échéance inconnue.'), amount: z.string().trim() })
  .transform((a, ctx) => {
    if (a.amount === '') return null
    const cents = parseEuros(a.amount)
    if (cents === null) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: "Une affectation n'est pas un montant valide." })
      return z.NEVER
    }
    return cents === 0 ? null : { rentChargeId: a.rentChargeId, amountCents: cents }
  })

export const recordPaymentSchema = z
  .object({
    leaseId: uuidField('Choisissez un bail.'),
    amount: eurosRequired('Saisissez un montant valide (par exemple 850,00).'),
    receivedOn: requiredDate('Saisissez une date de réception valide.'),
    mode,
    reference: optionalText(200, 'La référence est trop longue.'),
    comment: optionalText(500, 'Le commentaire est trop long.'),
    confirmCash: z.boolean(),
    allocations: z.array(allocation),
  })
  .transform((data) => ({
    ...data,
    allocations: data.allocations.filter((a): a is { rentChargeId: string; amountCents: number } => a !== null),
  }))
  .superRefine((data, ctx) => {
    if (data.amount <= 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Le montant du paiement doit être supérieur à zéro.' })
    }
    const total = data.allocations.reduce((sum, a) => sum + a.amountCents, 0)
    if (total > data.amount) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Les affectations dépassent le montant du paiement.' })
    }
    if (data.mode === 'cash' && data.amount >= CASH_WARNING_CENTS && !data.confirmCash) {
      ctx.addIssue({ code: 'custom', path: ['confirmCash'], message: 'Paiement en espèces de 1 000 € ou plus : confirmez-le pour continuer.' })
    }
  })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount }))

export const updatePaymentSchema = z.object({
  reference: optionalText(200, 'La référence est trop longue.'),
  comment: optionalText(500, 'Le commentaire est trop long.'),
  mode,
  receivedOn: requiredDate('Saisissez une date de réception valide.'),
})

export const reasonSchema = z.object({
  reason: z.string({ error: 'Indiquez le motif.' }).trim().min(1, 'Indiquez le motif.').max(300, 'Le motif est trop long.'),
})

export const moveAllocationSchema = z.object({
  chargeId: uuidField("Choisissez l'échéance de destination."),
  reason: reasonSchema.shape.reason,
})
