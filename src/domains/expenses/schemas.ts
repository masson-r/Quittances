import { z } from 'zod'
import { isValidIsoDate } from '@/lib/dates'
import { parseEuros } from '@/lib/money'

export const expenseSchema = z.object({
  propertyId: z.uuid('Choisissez un bien.'),
  categoryId: z.uuid('Choisissez une catégorie.'),
  expenseDate: z.string().refine(isValidIsoDate, 'Saisissez une date valide.'),
  description: z.string().trim().min(1, 'Décrivez la dépense.').max(500, 'La description est trop longue (500 caractères).'),
  amount: z
    .string()
    .transform((value, ctx) => {
      const cents = parseEuros(value)
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Saisissez un montant supérieur à zéro (par exemple 120,50).' })
        return z.NEVER
      }
      return cents
    }),
  recoverable: z.boolean(),
})

export const categoryNameSchema = z.string().trim().min(1, 'Saisissez un nom.').max(80, 'Le nom est trop long (80 caractères).')

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
export const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

/** Type reconnu à l'en-tête du fichier, jamais d'après son nom ou le type déclaré. */
export function sniffDocumentType(bytes: Uint8Array): DocumentType | null {
  const head = (n: number) => Array.from(bytes.subarray(0, n))
  if (head(5).join() === [0x25, 0x50, 0x44, 0x46, 0x2d].join()) return 'application/pdf'
  if (head(8).join() === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].join()) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}
