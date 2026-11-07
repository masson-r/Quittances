import { z } from 'zod'
import { optionalText } from '@/lib/form-state'

export const propertySchema = z.object({
  label: z.string({ error: 'Saisissez le libellé du bien.' }).trim().min(1, 'Saisissez le libellé du bien.').max(120, 'Le libellé est trop long.'),
  addressLine1: z.string({ error: "Saisissez l'adresse." }).trim().min(1, "Saisissez l'adresse.").max(200, "L'adresse est trop longue."),
  addressLine2: optionalText(200, "Le complément d'adresse est trop long."),
  postalCode: z.string({ error: 'Saisissez le code postal.' }).trim().regex(/^\d{5}$/, 'Le code postal comporte 5 chiffres.'),
  city: z.string({ error: 'Saisissez la ville.' }).trim().min(1, 'Saisissez la ville.').max(100, 'Le nom de la ville est trop long.'),
  description: optionalText(2000, 'La description est trop longue.'),
})

export type PropertyInput = z.infer<typeof propertySchema>

export const maintenanceNoteSchema = z.object({
  body: z.string({ error: 'Saisissez la note.' }).trim().min(1, 'Saisissez la note.').max(2000, 'La note est trop longue.'),
})

export const accessCodeSchema = z.object({
  label: z.string({ error: 'Saisissez le libellé.' }).trim().min(1, 'Saisissez le libellé.').max(80, 'Le libellé est trop long.'),
  code: z.string({ error: 'Saisissez le code.' }).trim().min(1, 'Saisissez le code.').max(200, 'Le code est trop long.'),
  note: optionalText(500, 'La note est trop longue.'),
})
