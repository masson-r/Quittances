'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { accessCodeSchema, maintenanceNoteSchema, propertySchema } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const propertyPath = (entityId: string, id: string) => `/espace/${entityId}/biens/${id}`

function ids(formData: FormData, ...keys: string[]): string[] | null {
  const values = keys.map((k) => formText(formData, k))
  return values.every((v) => uuid.safeParse(v).success) ? values : null
}

const PROPERTY_KEYS = ['label', 'addressLine1', 'addressLine2', 'postalCode', 'city', 'description']
const propertyFields = (formData: FormData) => ({
  label: formText(formData, 'label'),
  addressLine1: formText(formData, 'addressLine1'),
  addressLine2: formText(formData, 'addressLine2'),
  postalCode: formText(formData, 'postalCode'),
  city: formText(formData, 'city'),
  description: formText(formData, 'description'),
})

export async function createPropertyAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entity = ids(formData, 'entityId')
  if (!entity) return { error: 'Structure inconnue.' }
  const parsed = propertySchema.safeParse(propertyFields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, PROPERTY_KEYS) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .insert({
      entity_id: entity[0],
      label: parsed.data.label,
      address_line1: parsed.data.addressLine1,
      address_line2: parsed.data.addressLine2,
      postal_code: parsed.data.postalCode,
      city: parsed.data.city,
      description: parsed.data.description,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.code === '42501' ? DENIED : GENERIC }
  revalidatePath(`/espace/${entity[0]}/biens`)
  redirect(propertyPath(entity[0], data.id))
}

export async function updatePropertyAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'propertyId')
  if (!key) return { error: 'Bien inconnu.' }
  const parsed = propertySchema.safeParse(propertyFields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, PROPERTY_KEYS) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .update({
      label: parsed.data.label,
      address_line1: parsed.data.addressLine1,
      address_line2: parsed.data.addressLine2,
      postal_code: parsed.data.postalCode,
      city: parsed.data.city,
      description: parsed.data.description,
    })
    .eq('entity_id', key[0])
    .eq('id', key[1])
    .select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(propertyPath(key[0], key[1]))
  revalidatePath(`/espace/${key[0]}/biens`)
  return { success: 'Bien enregistré.' }
}

/** Archive ou restaure un bien : jamais de suppression (l'historique des baux et dépenses est conservé). */
export async function setPropertyArchivedAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'propertyId')
  if (!key) return { error: 'Bien inconnu.' }
  const archive = formText(formData, 'archive') === 'true'

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('entity_id', key[0])
    .eq('id', key[1])
    .select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(propertyPath(key[0], key[1]))
  revalidatePath(`/espace/${key[0]}/biens`)
  return { success: archive ? 'Bien archivé.' : 'Bien restauré.' }
}

export async function addMaintenanceNoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser()
  const key = ids(formData, 'entityId', 'propertyId')
  if (!key) return { error: 'Bien inconnu.' }
  const parsed = maintenanceNoteSchema.safeParse({ body: formText(formData, 'body') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['body']) }

  const supabase = await createClient()
  const { error } = await supabase
    .from('property_maintenance_notes')
    .insert({ entity_id: key[0], property_id: key[1], body: parsed.data.body, author_id: user.id })
  if (error) return { error: error.code === '42501' ? DENIED : GENERIC }
  revalidatePath(propertyPath(key[0], key[1]))
  return { success: 'Note ajoutée.' }
}

export async function saveAccessCodeAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'propertyId')
  if (!key) return { error: 'Bien inconnu.' }
  const parsed = accessCodeSchema.safeParse({ label: formText(formData, 'label'), code: formText(formData, 'code'), note: formText(formData, 'note') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['label', 'code', 'note']) }

  const supabase = await createClient()
  const codeId = formText(formData, 'codeId')
  const values = { label: parsed.data.label, code: parsed.data.code, note: parsed.data.note }
  if (codeId) {
    if (!uuid.safeParse(codeId).success) return { error: 'Code inconnu.' }
    const { data, error } = await supabase.from('property_access_codes').update(values).eq('id', codeId).eq('property_id', key[1]).select('id')
    if (error) return { error: GENERIC }
    if (!data || data.length === 0) return { error: DENIED }
  } else {
    const { error } = await supabase.from('property_access_codes').insert({ entity_id: key[0], property_id: key[1], ...values })
    if (error) return { error: error.code === '42501' ? DENIED : GENERIC }
  }
  revalidatePath(propertyPath(key[0], key[1]))
  return { success: 'Code enregistré.' }
}

export async function deleteAccessCodeAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'propertyId', 'codeId')
  if (!key) return { error: 'Code inconnu.' }
  const supabase = await createClient()
  const { data, error } = await supabase.from('property_access_codes').delete().eq('id', key[2]).eq('property_id', key[1]).select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(propertyPath(key[0], key[1]))
  return { success: 'Code supprimé.' }
}
