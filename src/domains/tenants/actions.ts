'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { privateDetailsSchema, tenantSchema } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const tenantPath = (entityId: string, id: string) => `/espace/${entityId}/locataires/${id}`

const TENANT_KEYS = ['lastName', 'firstName', 'email', 'phone', 'addressLine1', 'postalCode', 'city']
const PRIVATE_KEYS = ['birthDate', 'guarantorKind', 'guarantorName', 'guarantorContact', 'housingAid', 'note']

const tenantFields = (formData: FormData) => ({
  ...Object.fromEntries(TENANT_KEYS.map((k) => [k, formText(formData, k)])),
  paperDeliveryRequested: formData.get('paperDeliveryRequested') === 'on',
})

function ids(formData: FormData, ...keys: string[]): string[] | null {
  const values = keys.map((k) => formText(formData, k))
  return values.every((v) => uuid.safeParse(v).success) ? values : null
}

const tenantRow = (data: z.infer<typeof tenantSchema>) => ({
  last_name: data.lastName,
  first_name: data.firstName,
  email: data.email,
  phone: data.phone,
  address_line1: data.addressLine1,
  postal_code: data.postalCode,
  city: data.city,
  paper_delivery_requested: data.paperDeliveryRequested,
})

export async function createTenantAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entity = ids(formData, 'entityId')
  if (!entity) return { error: 'Structure inconnue.' }
  const parsed = tenantSchema.safeParse(tenantFields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, TENANT_KEYS) }

  const supabase = await createClient()
  const { data, error } = await supabase.from('tenants').insert({ entity_id: entity[0], ...tenantRow(parsed.data) }).select('id').single()
  if (error || !data) return { error: error?.code === '42501' ? DENIED : GENERIC }
  revalidatePath(`/espace/${entity[0]}/locataires`)
  redirect(tenantPath(entity[0], data.id))
}

export async function updateTenantAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'tenantId')
  if (!key) return { error: 'Dossier inconnu.' }
  const parsed = tenantSchema.safeParse(tenantFields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, TENANT_KEYS) }

  const supabase = await createClient()
  const { data, error } = await supabase.from('tenants').update(tenantRow(parsed.data)).eq('entity_id', key[0]).eq('id', key[1]).select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(tenantPath(key[0], key[1]))
  revalidatePath(`/espace/${key[0]}/locataires`)
  return { success: 'Dossier enregistré.' }
}

export async function setTenantArchivedAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'tenantId')
  if (!key) return { error: 'Dossier inconnu.' }
  const archive = formText(formData, 'archive') === 'true'

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('entity_id', key[0])
    .eq('id', key[1])
    .select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(tenantPath(key[0], key[1]))
  revalidatePath(`/espace/${key[0]}/locataires`)
  return { success: archive ? 'Dossier archivé.' : 'Dossier restauré.' }
}

export async function savePrivateDetailsAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'tenantId')
  if (!key) return { error: 'Dossier inconnu.' }
  const parsed = privateDetailsSchema.safeParse(Object.fromEntries(PRIVATE_KEYS.map((k) => [k, formText(formData, k)])))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, PRIVATE_KEYS) }

  const supabase = await createClient()
  const { error } = await supabase.from('tenant_private_details').upsert(
    {
      tenant_id: key[1],
      entity_id: key[0],
      birth_date: parsed.data.birthDate,
      guarantor_kind: parsed.data.guarantorKind,
      guarantor_name: parsed.data.guarantorName,
      guarantor_contact: parsed.data.guarantorContact,
      housing_aid: parsed.data.housingAid,
      note: parsed.data.note,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { error: error.code === '42501' ? DENIED : GENERIC }
  revalidatePath(tenantPath(key[0], key[1]))
  return { success: 'Informations sensibles enregistrées.' }
}
