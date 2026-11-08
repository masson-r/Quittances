import { z } from 'zod'
import { isValidIsoDate } from '@/lib/dates'
import { parseEuros } from '@/lib/money'

export const requiredDate = (message: string) => z.string({ error: message }).trim().refine(isValidIsoDate, message)

export const optionalDate = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidIsoDate(v), message)

/** Montant saisi en euros, converti en centimes ; vide accepté (null) quand le champ est facultatif. */
export const euros = (message: string, { required }: { required: boolean }) =>
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

export const uuidField = (message: string) => z.string({ error: message }).pipe(z.uuid(message))

/** Montant obligatoire en euros → centimes (jamais null). */
export const eurosRequired = (message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseEuros(v)
      if (cents === null) {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return cents
    })
