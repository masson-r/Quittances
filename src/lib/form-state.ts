import { z } from 'zod'

export type FieldErrors = Record<string, string[] | undefined>

/** État renvoyé par les Server Actions de formulaire. */
export interface FormState {
  fieldErrors?: FieldErrors
  error?: string
  success?: string
  /** Valeurs saisies, renvoyées après une erreur : React vide les champs d'un formulaire à la fin de l'action. */
  values?: Record<string, string>
}

export const formText = (formData: FormData, key: string): string => String(formData.get(key) ?? '')

/** Valeurs saisies pour les champs indiqués. */
export const submittedValues = (formData: FormData, keys: string[]): Record<string, string> => Object.fromEntries(keys.map((k) => [k, formText(formData, k)]))

/** Erreurs de validation par champ, prêtes à afficher. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors
}

/** Chaîne facultative : vide devient null. */
export const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === '' ? null : value))
