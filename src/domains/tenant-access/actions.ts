'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, optionalText, zodFieldErrors, type FormState } from '@/lib/form-state'
import { isInvitationToken } from '@/domains/identity/roles'
import { requireUser } from '@/domains/identity/session'
import { CONSENT_VERSION } from './consent'

export interface AccessFormState extends FormState {
  /** Lien d'invitation en clair : affiché une seule fois. */
  link?: string
}

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const INVALID_LINK = 'Lien invalide ou expiré.'
const CONSENT_REQUIRED = 'Vous devez consentir à la remise dématérialisée de vos quittances pour envoyer la demande.'
const MY_SPACE = '/mon-espace'

function friendly(message: string | undefined): string {
  if (!message) return GENERIC
  if (message.includes('Droit insuffisant') || message.includes('introuvable')) return "Vous n'avez pas le droit d'effectuer cette action."
  if (message.includes('déjà rattaché')) return 'Ce dossier est déjà rattaché à un compte. Révoquez le rattachement avant de réinviter.'
  if (message.includes('déjà été traitée')) return 'Cette demande a déjà été traitée ou a expiré.'
  if (message.includes("n'est pas actif")) return "Ce rattachement n'est plus actif."
  return GENERIC
}

async function siteOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const local = host.startsWith('127.0.0.1') || host.startsWith('localhost')
  const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Le propriétaire crée (ou régénère) le lien d'invitation d'un dossier. */
export async function inviteTenantAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const tenantId = formText(formData, 'tenantId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(tenantId).success) return { error: 'Dossier inconnu.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_tenant_invitation', { p_tenant_id: tenantId }).single()
  if (error || !data) return { error: friendly(error?.message) }
  revalidatePath(`/espace/${entityId}/locataires/${tenantId}`)
  const { token } = data as { token: string }
  return { success: "Lien d'invitation créé.", link: `${await siteOrigin()}/rattachement/${token}` }
}

async function accessCall(formData: FormData, fn: string, args: Record<string, unknown>, done: string): Promise<AccessFormState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc(fn, args)
  if (error) return { error: friendly(error.message) }
  const entityId = formText(formData, 'entityId')
  if (uuid.safeParse(entityId).success) revalidatePath(`/espace/${entityId}`, 'layout')
  revalidatePath(MY_SPACE)
  return { success: done }
}

export async function decideAccessAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser()
  const requestId = formText(formData, 'requestId')
  const decision = formText(formData, 'decision')
  if (!uuid.safeParse(requestId).success || (decision !== 'approve' && decision !== 'refuse')) return { error: 'Demande inconnue.' }
  return accessCall(formData, 'decide_tenant_access', { p_request_id: requestId, p_approve: decision === 'approve' }, decision === 'approve' ? 'Demande validée.' : 'Demande refusée.')
}

/** Révocation par le propriétaire ou détachement par le locataire. */
export async function revokeAccessAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser()
  const requestId = formText(formData, 'requestId')
  if (!uuid.safeParse(requestId).success) return { error: 'Rattachement inconnu.' }
  return accessCall(formData, 'revoke_tenant_access', { p_request_id: requestId }, 'Rattachement révoqué.')
}

export async function withdrawConsentAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser()
  const requestId = formText(formData, 'requestId')
  if (!uuid.safeParse(requestId).success) return { error: 'Rattachement inconnu.' }
  return accessCall(
    formData,
    'withdraw_tenant_consent',
    { p_request_id: requestId },
    'Consentement retiré. Vos nouvelles quittances ne seront plus mises à disposition en ligne ; le propriétaire vous les remettra sur papier.',
  )
}

/** Utilise un lien de rattachement : demande en attente, avec consentement obligatoire. */
export async function requestAccessAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser({ allowMfaPending: true })
  const token = formText(formData, 'token')
  if (!isInvitationToken(token)) return { error: INVALID_LINK }
  if (formData.get('consent') !== 'on') return { error: CONSENT_REQUIRED }

  // Empreinte de l'adresse réseau pour la limitation de débit : l'adresse elle-même n'est pas conservée.
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'inconnue'
  const clientKey = createHash('sha256').update(ip).digest('hex')

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('consume_tenant_invitation', { p_token: token, p_client_key: clientKey, p_consent: true, p_consent_version: CONSENT_VERSION })
    .single()
  if (error || !data) return { error: GENERIC }
  const { status } = data as { status: string }
  if (status === 'locked') return { error: 'Trop de tentatives. Réessayez dans une heure.' }
  if (status === 'consent_required') return { error: CONSENT_REQUIRED }
  if (status !== 'ok') return { error: INVALID_LINK }
  redirect(MY_SPACE)
}

const contactSchema = z.object({
  phone: optionalText(30, 'Le téléphone est trop long.'),
  addressLine1: optionalText(200, "L'adresse est trop longue."),
  postalCode: optionalText(10, 'Le code postal est trop long.'),
  city: optionalText(100, 'La ville est trop longue.'),
})

export async function updateContactAction(_: AccessFormState, formData: FormData): Promise<AccessFormState> {
  await requireUser()
  const tenantId = formText(formData, 'tenantId')
  if (!uuid.safeParse(tenantId).success) return { error: 'Dossier inconnu.' }
  const parsed = contactSchema.safeParse({
    phone: formText(formData, 'phone'),
    addressLine1: formText(formData, 'addressLine1'),
    postalCode: formText(formData, 'postalCode'),
    city: formText(formData, 'city'),
  })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_my_contact', {
    p_tenant_id: tenantId,
    p_phone: parsed.data.phone,
    p_address_line1: parsed.data.addressLine1,
    p_postal_code: parsed.data.postalCode,
    p_city: parsed.data.city,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath(MY_SPACE)
  return { success: 'Coordonnées enregistrées.' }
}
