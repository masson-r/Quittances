import { z } from 'zod'
import { optionalText } from '@/lib/form-state'

const optionalEmail = optionalText(200, "L'adresse e-mail est trop longue.")
  .transform((v) => (v === null ? null : v.toLowerCase()))
  .refine((v) => v === null || z.email().safeParse(v).success, 'Saisissez une adresse e-mail valide.')

const optionalPostalCode = optionalText(10, 'Le code postal est trop long.').refine((v) => v === null || /^\d{5}$/.test(v), 'Le code postal comporte 5 chiffres.')

export const tenantSchema = z.object({
  lastName: z.string({ error: 'Saisissez le nom.' }).trim().min(1, 'Saisissez le nom.').max(100, 'Le nom est trop long.'),
  firstName: z.string().trim().max(100, 'Le prénom est trop long.'),
  email: optionalEmail,
  phone: optionalText(30, 'Le numéro de téléphone est trop long.'),
  addressLine1: optionalText(200, "L'adresse est trop longue."),
  postalCode: optionalPostalCode,
  city: optionalText(100, 'Le nom de la ville est trop long.'),
  paperDeliveryRequested: z.boolean(),
})

export type TenantInput = z.infer<typeof tenantSchema>

export const GUARANTOR_KINDS = ['none', 'person', 'visale', 'bank', 'other'] as const
export const HOUSING_AIDS = ['none', 'to_tenant', 'to_landlord'] as const

export const GUARANTOR_LABELS: Record<(typeof GUARANTOR_KINDS)[number], string> = {
  none: 'Aucun',
  person: 'Personne physique',
  visale: 'Visale',
  bank: 'Caution bancaire',
  other: 'Autre',
}
export const HOUSING_AID_LABELS: Record<(typeof HOUSING_AIDS)[number], string> = {
  none: 'Aucune',
  to_tenant: 'Versée au locataire',
  to_landlord: 'Versée au bailleur',
}

const birthDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => {
    if (v === null) return true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10)
  }, 'Saisissez une date de naissance valide (passée, au format AAAA-MM-JJ).')

export const privateDetailsSchema = z.object({
  birthDate,
  guarantorKind: z.enum(GUARANTOR_KINDS, { error: 'Choisissez un type de garant.' }),
  guarantorName: optionalText(200, 'Le nom du garant est trop long.'),
  guarantorContact: optionalText(300, 'Les coordonnées du garant sont trop longues.'),
  housingAid: z.enum(HOUSING_AIDS, { error: "Choisissez un type d'aide au logement." }),
  note: optionalText(1000, 'La note est trop longue.'),
})
