'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { fieldErrors, inviteMemberSchema, memberRoleSchema, type FieldErrors } from './schemas'
import { isInvitationToken } from './roles'
import { requireUser } from './session'

export interface MemberFormState {
  fieldErrors?: FieldErrors
  error?: string
  success?: string
  /** Lien d'invitation en clair : affiché une seule fois. */
  link?: string
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '')
const uuid = z.uuid()
const membersPath = (entityId: string) => `/espace/${entityId}/membres`

async function siteOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const local = host.startsWith('127.0.0.1') || host.startsWith('localhost')
  const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Messages en français pour les erreurs que la base lève volontairement. */
function friendly(message: string | undefined): string {
  if (!message) return "L'opération a échoué. Réessayez dans quelques instants."
  if (message.includes('au moins un administrateur')) return 'Une structure doit garder au moins un administrateur actif.'
  if (message.includes('déjà membre')) return 'Cette personne est déjà membre de la structure.'
  if (message.includes('Droit insuffisant')) return "Vous n'avez pas le droit de gérer les membres de cette structure."
  if (message.includes('introuvable')) return 'Cette invitation a déjà été utilisée ou révoquée.'
  return "L'opération a échoué. Réessayez dans quelques instants."
}

/** Crée (ou régénère) une invitation et renvoie le lien, affiché une seule fois. */
export async function inviteMemberAction(_: MemberFormState, formData: FormData): Promise<MemberFormState> {
  await requireUser()
  const entityId = text(formData, 'entityId')
  if (!uuid.safeParse(entityId).success) return { error: 'Structure inconnue.' }
  const parsed = inviteMemberSchema.safeParse({ email: text(formData, 'email'), role: text(formData, 'role') })
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('create_member_invitation', { p_entity_id: entityId, p_email: parsed.data.email, p_role: parsed.data.role })
    .single()
  if (error || !data) return { error: friendly(error?.message) }

  revalidatePath(membersPath(entityId))
  const { token } = data as { token: string }
  return { success: `Invitation créée pour ${parsed.data.email}.`, link: `${await siteOrigin()}/invitation/${token}` }
}

export async function revokeInvitationAction(_: MemberFormState, formData: FormData): Promise<MemberFormState> {
  await requireUser()
  const entityId = text(formData, 'entityId')
  const invitationId = text(formData, 'invitationId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(invitationId).success) return { error: 'Invitation inconnue.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId })
  if (error) return { error: friendly(error.message) }
  revalidatePath(membersPath(entityId))
  return { success: 'Invitation révoquée.' }
}

async function updateMembership(formData: FormData, values: { role?: string; status?: string }, done: string): Promise<MemberFormState> {
  await requireUser()
  const entityId = text(formData, 'entityId')
  const membershipId = text(formData, 'membershipId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(membershipId).success) return { error: 'Membre inconnu.' }

  const supabase = await createClient()
  const { data, error } = await supabase.from('entity_memberships').update(values).eq('id', membershipId).eq('entity_id', entityId).select('id')
  if (error) return { error: friendly(error.message) }
  if (!data || data.length === 0) return { error: friendly('Droit insuffisant') }
  revalidatePath(membersPath(entityId))
  return { success: done }
}

export async function changeRoleAction(_: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const role = memberRoleSchema.safeParse(text(formData, 'role'))
  if (!role.success) return { error: 'Choisissez un rôle.' }
  return updateMembership(formData, { role: role.data }, 'Rôle modifié.')
}

export async function setMemberStatusAction(_: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const status = text(formData, 'status')
  if (status !== 'active' && status !== 'suspended') return { error: 'Statut inconnu.' }
  return updateMembership(formData, { status }, status === 'suspended' ? 'Membre suspendu.' : 'Membre réactivé.')
}

/** Utilise un lien d'invitation (bouton explicite : un simple aperçu du lien ne le consomme pas). */
export async function acceptInvitationAction(_: MemberFormState, formData: FormData): Promise<MemberFormState> {
  await requireUser({ allowMfaPending: true })
  const token = text(formData, 'token')
  const INVALID = { error: 'Lien invalide ou expiré.' }
  if (!isInvitationToken(token)) return INVALID

  // Empreinte de l'adresse réseau pour la limitation de débit : l'adresse elle-même n'est pas conservée.
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'inconnue'
  const clientKey = createHash('sha256').update(ip).digest('hex')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('consume_invitation', { p_token: token, p_client_key: clientKey }).single()
  if (error || !data) return { error: "L'opération a échoué. Réessayez dans quelques instants." }
  const { status } = data as { status: string }
  if (status === 'locked') return { error: 'Trop de tentatives. Réessayez dans une heure.' }
  if (status !== 'ok') return INVALID
  redirect('/espace')
}
