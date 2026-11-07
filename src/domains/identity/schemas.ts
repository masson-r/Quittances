import { z } from 'zod'

const email = z
  .string({ error: 'Saisissez votre adresse e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Saisissez une adresse e-mail valide.' }))

// Mêmes exigences que la configuration de Supabase Auth (12 caractères, minuscule, majuscule, chiffre).
const password = z
  .string({ error: 'Saisissez un mot de passe.' })
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
  .max(72, 'Le mot de passe ne doit pas dépasser 72 caractères.')
  .regex(/[a-z]/, 'Le mot de passe doit contenir une minuscule.')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir une majuscule.')
  .regex(/\d/, 'Le mot de passe doit contenir un chiffre.')

const name = (label: string) =>
  z
    .string({ error: `Saisissez ${label}.` })
    .trim()
    .min(1, `Saisissez ${label}.`)
    .max(80, `${label[0].toUpperCase()}${label.slice(1)} est trop long.`)

const sameAsPassword = (data: { password: string; confirmPassword: string }, ctx: z.RefinementCtx) => {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Les mots de passe ne sont pas identiques.' })
  }
}

export const signUpSchema = z
  .object({
    firstName: name('votre prénom'),
    lastName: name('votre nom'),
    email,
    password,
    confirmPassword: z.string(),
  })
  .superRefine(sameAsPassword)

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
})

export const forgotPasswordSchema = z.object({ email })

export const newPasswordSchema = z.object({ password, confirmPassword: z.string() }).superRefine(sameAsPassword)

export const totpCodeSchema = z.object({
  code: z
    .string({ error: 'Saisissez le code à 6 chiffres.' })
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Saisissez le code à 6 chiffres.')),
})

export const recoveryCodeSchema = z.object({
  code: z
    .string({ error: 'Saisissez un code de secours.' })
    .transform((v) => v.replace(/[\s-]/g, '').toLowerCase())
    .pipe(z.string().regex(/^[0-9a-f]{16}$/, 'Saisissez un code de secours valide (16 caractères).'))
    .transform((v) => `${v.slice(0, 4)}-${v.slice(4, 8)}-${v.slice(8, 12)}-${v.slice(12)}`),
})

export type FieldErrors = Record<string, string[] | undefined>

/** Erreurs de validation par champ, prêtes à afficher. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors
}
