import { z } from 'zod'
import { optionalText } from '@/lib/form-state'
import { parseSignedEuros } from '@/lib/money-signed'
import { optionalDate, requiredDate, uuidField } from '@/lib/zod-fields'
import { PAYMENT_MODES } from '@/domains/finance/schemas'

export const SETTLEMENT_KINDS = ['charges_adjustment', 'unallocated_refund'] as const
export const SETTLEMENT_KIND_LABELS: Record<(typeof SETTLEMENT_KINDS)[number], string> = {
  charges_adjustment: 'Régularisation de charges',
  unallocated_refund: 'Remboursement d’un paiement non affecté',
}

const mode = z.enum(PAYMENT_MODES, { error: 'Choisissez un mode.' })

const signedAmount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const cents = parseSignedEuros(v)
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: 'Saisissez un montant valide (par exemple 120,50 ou -80).' })
      return z.NEVER
    }
    return cents
  })

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.uuid("Paiement inconnu.").nullable())

/** `today` : date du jour (AAAA-MM-JJ), fournie par l'appelant pour garder le schéma pur et testable. */
export const recordSettlementSchema = (today: string) =>
  z
    .object({
      leaseId: uuidField('Choisissez un bail.'),
      kind: z.enum(SETTLEMENT_KINDS, { error: 'Choisissez la nature de l’apurement.' }),
      settledOn: requiredDate('Saisissez une date valide.'),
      amount: signedAmount,
      mode,
      reason: z.string({ error: 'Indiquez le motif.' }).trim().min(1, 'Indiquez le motif.').max(300, 'Le motif est trop long.'),
      periodStart: optionalDate('Saisissez une date de début de période valide.'),
      periodEnd: optionalDate('Saisissez une date de fin de période valide.'),
      paymentId: optionalUuid,
      isFinal: z.boolean(),
      reference: optionalText(200, 'La référence est trop longue.'),
      comment: optionalText(500, 'Le commentaire est trop long.'),
    })
    .superRefine((d, ctx) => {
      if (d.settledOn > today) ctx.addIssue({ code: 'custom', path: ['settledOn'], message: 'La date ne peut pas être dans le futur.' })
      if (d.amount === 0 && !d.isFinal) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Un montant nul n’est permis que pour l’apurement final.' })
      if ((d.periodStart === null) !== (d.periodEnd === null)) ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'Indiquez le début et la fin de la période, ou aucun des deux.' })
      if (d.periodStart !== null && d.periodEnd !== null && d.periodEnd < d.periodStart) ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'La fin de période ne peut pas précéder son début.' })
      if (d.kind === 'unallocated_refund') {
        if (d.amount <= 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Un remboursement est un montant positif.' })
        if (d.paymentId === null) ctx.addIssue({ code: 'custom', path: ['paymentId'], message: 'Choisissez le paiement à rembourser.' })
        if (d.isFinal) ctx.addIssue({ code: 'custom', path: ['isFinal'], message: 'Un remboursement du non affecté ne peut pas être l’apurement final.' })
      }
    })
    .transform(({ amount, paymentId, kind, ...rest }) => ({ ...rest, kind, amountCents: amount, paymentId: kind === 'unallocated_refund' ? paymentId : null }))

export const updateSettlementSchema = (today: string) =>
  z
    .object({
      settledOn: requiredDate('Saisissez une date valide.'),
      mode,
      reference: optionalText(200, 'La référence est trop longue.'),
      comment: optionalText(500, 'Le commentaire est trop long.'),
    })
    .superRefine((d, ctx) => {
      if (d.settledOn > today) ctx.addIssue({ code: 'custom', path: ['settledOn'], message: 'La date ne peut pas être dans le futur.' })
    })
