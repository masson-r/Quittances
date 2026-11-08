import { z } from 'zod'
import { isValidIsoDate } from '@/lib/dates'
import { parseEuros } from '@/lib/money'

const requiredDate = (message: string) => z.string({ error: message }).trim().refine(isValidIsoDate, message)

const optionalDate = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidIsoDate(v), message)

const euros = (message: string, { required }: { required: boolean }) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '' && !required) return null
      const cents = parseEuros(v)
      if (cents === null) {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return cents
    })

const uuid = (message: string) => z.string({ error: message }).pipe(z.uuid(message))

const dueDay = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, "Le jour d'échéance est un nombre de 1 à 31.")
  .transform(Number)
  .refine((n) => n >= 1 && n <= 31, "Le jour d'échéance est un nombre de 1 à 31.")

export const createLeaseSchema = z
  .object({
    propertyId: uuid('Choisissez un bien.'),
    tenantIds: z
      .array(uuid('Locataire inconnu.'), { error: 'Choisissez au moins un locataire.' })
      .min(1, 'Choisissez au moins un locataire.')
      .transform((ids) => [...new Set(ids)]),
    startDate: requiredDate('Saisissez une date de début valide.'),
    endDate: optionalDate('Saisissez une date de fin valide.'),
    dueDay,
    rent: euros('Saisissez un loyer valide (par exemple 850,00).', { required: true }),
    charges: euros('Saisissez des charges valides (0 si aucune).', { required: true }),
    deposit: euros('Saisissez un dépôt de garantie valide.', { required: false }),
    depositReceivedOn: optionalDate('Saisissez une date de réception valide.'),
  })
  .superRefine((data, ctx) => {
    if (data.endDate !== null && data.endDate < data.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La date de fin ne peut pas précéder la date de début.' })
    }
  })
  .transform(({ rent, charges, deposit, ...rest }) => ({ ...rest, rentCents: rent, chargesCents: charges, depositCents: deposit }))

export const addTermSchema = z
  .object({
    effectiveFrom: requiredDate("Saisissez une date d'effet valide."),
    rent: euros('Saisissez un loyer valide (par exemple 850,00).', { required: true }),
    charges: euros('Saisissez des charges valides (0 si aucune).', { required: true }),
    reason: z
      .string()
      .trim()
      .max(200, 'Le motif est trop long.')
      .transform((v) => (v === '' ? null : v)),
  })
  .transform(({ rent, charges, ...rest }) => ({ ...rest, rentCents: rent, chargesCents: charges }))

export const coTenantSchema = z
  .object({
    tenantId: uuid('Choisissez un locataire.'),
    startDate: requiredDate("Saisissez une date d'entrée valide."),
    endDate: optionalDate('Saisissez une date de sortie valide.'),
  })
  .superRefine((data, ctx) => {
    if (data.endDate !== null && data.endDate < data.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: "La sortie ne peut pas précéder l'entrée." })
    }
  })

export const endLeaseSchema = z.object({ endDate: requiredDate('Saisissez une date de fin valide.') })
