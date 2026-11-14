'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fieldErrors, recoveryCodeSchema, totpCodeSchema, type FieldErrors } from './schemas'
import { requireUser } from './session'

export interface EnrollmentStart {
  error?: string
  factorId?: string
  qrCode?: string
  secret?: string
}

export interface MfaFormState {
  fieldErrors?: FieldErrors
  error?: string
  /** Code validé : le client ouvre alors l'espace par une navigation complète. */
  verified?: boolean
  /** Codes de secours en clair : affichés une seule fois. */
  recoveryCodes?: string[]
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '')

/** Démarre l'activation : supprime les facteurs jamais validés, puis en crée un nouveau (QR code et clé). */
export async function startEnrollmentAction(): Promise<EnrollmentStart> {
  await requireUser({ allowMfaPending: true })
  const supabase = await createClient()

  const { data: factors } = await supabase.auth.mfa.listFactors()
  if (factors && factors.totp.length > 0) return { error: 'Un second facteur est déjà activé sur ce compte.' }
  for (const factor of factors?.all ?? []) {
    if (factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id })
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Loyo-reg',
    friendlyName: 'Application d\'authentification',
  })
  if (error || !data) return { error: "L'activation a échoué. Réessayez dans quelques instants." }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Valide le premier code, puis génère les codes de secours (affichés une seule fois). */
export async function confirmEnrollmentAction(_: MfaFormState, formData: FormData): Promise<MfaFormState> {
  await requireUser({ allowMfaPending: true })
  const parsed = totpCodeSchema.safeParse({ code: text(formData, 'code') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: text(formData, 'factorId'), code: parsed.data.code })
  if (error) return { fieldErrors: { code: ['Ce code est incorrect ou expiré. Vérifiez l\'heure de votre téléphone et réessayez.'] } }

  const { data: codes, error: codesError } = await supabase.rpc('regenerate_recovery_codes')
  if (codesError || !codes) return { error: 'Le second facteur est activé, mais les codes de secours n\'ont pas pu être créés. Régénérez-les depuis la page Sécurité.' }
  return { recoveryCodes: codes }
}

/** Connexion : validation du code de l'application d'authentification. */
export async function verifyTotpAction(_: MfaFormState, formData: FormData): Promise<MfaFormState> {
  await requireUser({ allowMfaPending: true })
  const parsed = totpCodeSchema.safeParse({ code: text(formData, 'code') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const factor = factors?.totp[0]
  if (!factor) redirect('/securite/activation')

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code })
  if (error) return { fieldErrors: { code: ['Ce code est incorrect ou expiré.'] } }
  // La session vient de passer au niveau aal2 : le navigateur recharge la page (navigation complète) au lieu de suivre une
  // redirection, car son cache de routes garde sinon la redirection vers la vérification obtenue avant le code.
  return { verified: true }
}

/** Second facteur perdu : un code de secours supprime le facteur, il faut en activer un nouveau. */
export async function redeemRecoveryCodeAction(_: MfaFormState, formData: FormData): Promise<MfaFormState> {
  await requireUser({ allowMfaPending: true })
  const parsed = recoveryCodeSchema.safeParse({ code: text(formData, 'code') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('use_recovery_code', { p_code: parsed.data.code })
  if (error) return { error: "La vérification a échoué. Réessayez dans quelques instants." }
  if (data === 'locked') return { error: 'Trop d\'essais incorrects. Réessayez dans une heure, ou contactez l\'opérateur.' }
  if (data !== 'ok') return { fieldErrors: { code: ['Ce code de secours est incorrect ou déjà utilisé.'] } }
  redirect('/securite/activation?secours=1')
}

/** Nouveaux codes de secours (les anciens cessent de fonctionner). Exige un second facteur validé. */
export async function regenerateRecoveryCodesAction(): Promise<MfaFormState> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('regenerate_recovery_codes')
  if (error || !data) return { error: 'Impossible de générer de nouveaux codes. Vérifiez votre second facteur.' }
  return { recoveryCodes: data }
}
