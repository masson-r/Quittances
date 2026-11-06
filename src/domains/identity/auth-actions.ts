'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/safe-redirect'
import { fieldErrors, forgotPasswordSchema, newPasswordSchema, signInSchema, signUpSchema, type FieldErrors } from './schemas'

export interface FormState {
  fieldErrors?: FieldErrors
  error?: string
  success?: string
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '')

export async function signUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(['firstName', 'lastName', 'email', 'password', 'confirmPassword'].map((k) => [k, text(formData, k)])))
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { first_name: parsed.data.firstName, last_name: parsed.data.lastName } },
  })
  if (error && error.code !== 'user_already_exists') {
    if (error.code === 'weak_password') return { fieldErrors: { password: ['Ce mot de passe est trop faible.'] } }
    return { error: "L'inscription a échoué. Réessayez dans quelques instants." }
  }
  // Même message que l'adresse existe déjà ou non : on ne révèle pas quels comptes existent.
  return { success: 'Un message de confirmation vient de vous être envoyé. Ouvrez le lien qu\'il contient pour activer votre compte.' }
}

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: text(formData, 'email'), password: text(formData, 'password') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    if (error.code === 'email_not_confirmed') return { error: "Confirmez d'abord votre adresse e-mail avec le message que nous vous avons envoyé." }
    if (error.code === 'user_banned') return { error: "Ce compte est désactivé. Contactez l'administrateur de votre structure." }
    return { error: 'Adresse e-mail ou mot de passe incorrect.' }
  }
  redirect(safeNextPath(text(formData, 'next')))
}

export async function forgotPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: text(formData, 'email') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(parsed.data.email)
  return { success: 'Si un compte existe pour cette adresse, un message de réinitialisation vient d\'être envoyé.' }
}

export async function updatePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({ password: text(formData, 'password'), confirmPassword: text(formData, 'confirmPassword') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Votre lien a expiré. Demandez un nouveau lien de réinitialisation.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    if (error.code === 'same_password') return { fieldErrors: { password: ['Choisissez un mot de passe différent de l\'ancien.'] } }
    if (error.code === 'weak_password') return { fieldErrors: { password: ['Ce mot de passe est trop faible.'] } }
    return { error: 'La modification a échoué. Réessayez dans quelques instants.' }
  }
  // Les autres appareils sont déconnectés ; celui-ci reste connecté.
  await supabase.auth.signOut({ scope: 'others' })
  redirect('/espace')
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/connexion')
}
