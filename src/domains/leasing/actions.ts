'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { addTermSchema, coTenantSchema, createLeaseSchema, endLeaseSchema } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const leasePath = (entityId: string, id: string) => `/espace/${entityId}/baux/${id}`

function ids(formData: FormData, ...keys: string[]): string[] | null {
  const values = keys.map((k) => formText(formData, k))
  return values.every((v) => uuid.safeParse(v).success) ? values : null
}

/** Messages en français pour les refus que la base lève volontairement. */
function friendly(error: { code?: string; message?: string }): string {
  const message = error.message ?? ''
  if (error.code === '23P01' && message.includes('leases_no_overlap')) return 'Ce bien a déjà un bail sur tout ou partie de cette période.'
  if (error.code === '23P01' && message.includes('lease_tenants_no_overlap')) return 'Ce locataire est déjà présent sur ce bail à ces dates.'
  if (error.code === '23505') return 'Une version des conditions existe déjà à cette date.'
  if (error.code === '42501' || message.includes('Droit insuffisant')) return DENIED
  if (message.includes('période du bail') || message.includes('date d\'effet') || message.includes('dépasse les nouvelles dates') || message.includes('précède le début')) {
    return message.replace(/^.*?:\s*/, '')
  }
  return GENERIC
}

const LEASE_KEYS = ['propertyId', 'startDate', 'endDate', 'dueDay', 'rent', 'charges', 'deposit', 'depositReceivedOn']

export async function createLeaseAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entity = ids(formData, 'entityId')
  if (!entity) return { error: 'Structure inconnue.' }
  const tenantIds = formData.getAll('tenantIds').map(String)
  const parsed = createLeaseSchema.safeParse({ ...Object.fromEntries(LEASE_KEYS.map((k) => [k, formText(formData, k)])), tenantIds })
  const kept = { ...submittedValues(formData, LEASE_KEYS), tenantIds: tenantIds.join(',') }
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: kept }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_lease', {
    p_entity_id: entity[0],
    p_property_id: parsed.data.propertyId,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_due_day: parsed.data.dueDay,
    p_rent_cents: parsed.data.rentCents,
    p_charges_cents: parsed.data.chargesCents,
    p_tenant_ids: parsed.data.tenantIds,
    p_deposit_cents: parsed.data.depositCents,
    p_deposit_received_on: parsed.data.depositReceivedOn,
  })
  if (error || !data) return { error: friendly(error ?? {}), values: kept }
  revalidatePath(`/espace/${entity[0]}/baux`)
  redirect(leasePath(entity[0], data as string))
}

export async function addTermAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId')
  if (!key) return { error: 'Bail inconnu.' }
  const keys = ['effectiveFrom', 'rent', 'charges', 'reason']
  const parsed = addTermSchema.safeParse(Object.fromEntries(keys.map((k) => [k, formText(formData, k)])))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, keys) }

  const supabase = await createClient()
  const { error } = await supabase.from('rental_terms').insert({
    entity_id: key[0],
    lease_id: key[1],
    effective_from: parsed.data.effectiveFrom,
    rent_cents: parsed.data.rentCents,
    charges_cents: parsed.data.chargesCents,
    reason: parsed.data.reason,
  })
  if (error) return { error: friendly(error), values: submittedValues(formData, keys) }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Nouvelles conditions enregistrées.' }
}

export async function addCoTenantAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId')
  if (!key) return { error: 'Bail inconnu.' }
  const keys = ['tenantId', 'startDate', 'endDate']
  const parsed = coTenantSchema.safeParse(Object.fromEntries(keys.map((k) => [k, formText(formData, k)])))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, keys) }

  const supabase = await createClient()
  const { error } = await supabase
    .from('lease_tenants')
    .insert({ entity_id: key[0], lease_id: key[1], tenant_id: parsed.data.tenantId, start_date: parsed.data.startDate, end_date: parsed.data.endDate })
  if (error) return { error: friendly(error), values: submittedValues(formData, keys) }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Locataire ajouté au bail.' }
}

export async function endPresenceAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId', 'presenceId')
  if (!key) return { error: 'Présence inconnue.' }
  const parsed = endLeaseSchema.safeParse({ endDate: formText(formData, 'endDate') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['endDate']) }

  const supabase = await createClient()
  const { data, error } = await supabase.from('lease_tenants').update({ end_date: parsed.data.endDate }).eq('id', key[2]).eq('lease_id', key[1]).select('id')
  if (error) return { error: friendly(error) }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Sortie enregistrée.' }
}

export async function endLeaseAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId')
  if (!key) return { error: 'Bail inconnu.' }
  const parsed = endLeaseSchema.safeParse({ endDate: formText(formData, 'endDate') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['endDate']) }

  const supabase = await createClient()
  const { error } = await supabase.rpc('end_lease', { p_lease_id: key[1], p_end_date: parsed.data.endDate })
  if (error) return { error: friendly(error), values: submittedValues(formData, ['endDate']) }
  revalidatePath(leasePath(key[0], key[1]))
  revalidatePath(`/espace/${key[0]}/baux`)
  return { success: 'Fin de bail enregistrée.' }
}
