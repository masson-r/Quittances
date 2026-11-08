'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { todayInParis } from '@/lib/dates'
import { reasonSchema } from '@/domains/finance/schemas'
import { requireUser } from '@/domains/identity/session'
import { recordSettlementSchema, updateSettlementSchema } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const leasePath = (entityId: string, leaseId: string) => `/espace/${entityId}/baux/${leaseId}`

function ids(formData: FormData, ...keys: string[]): string[] | null {
  const values = keys.map((k) => formText(formData, k))
  return values.every((v) => uuid.safeParse(v).success) ? values : null
}

function friendly(error: { code?: string; message?: string }): string {
  const message = error.message ?? ''
  if (error.code === '42501' || message.includes('Droit insuffisant')) return DENIED
  if (error.code === '23505' || message.includes('déjà un apurement final')) return 'Ce bail a déjà un apurement final : annulez-le avant d’en saisir un autre.'
  for (const known of ['dépasse le montant non affecté', 'Impossible de rembourser un paiement annulé', 'motif est obligatoire', 'déjà annulé', 'dans le futur', 'montant nul']) {
    if (message.includes(known)) return message.replace(/^.*?(?=[A-ZÉÀ])/, '')
  }
  return GENERIC
}

const KEYS = ['kind', 'settledOn', 'amount', 'mode', 'reason', 'periodStart', 'periodEnd', 'paymentId', 'reference', 'comment']

export async function recordSettlementAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId')
  if (!key) return { error: 'Bail inconnu.' }
  const kept = submittedValues(formData, KEYS)
  const parsed = recordSettlementSchema(todayInParis()).safeParse({
    ...Object.fromEntries(KEYS.map((k) => [k, formText(formData, k)])),
    leaseId: key[1],
    isFinal: formData.get('isFinal') === 'on',
  })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: kept }

  const supabase = await createClient()
  const { error } = await supabase.rpc('record_charge_settlement', {
    p_lease_id: key[1],
    p_kind: parsed.data.kind,
    p_settled_on: parsed.data.settledOn,
    p_amount_cents: parsed.data.amountCents,
    p_mode: parsed.data.mode,
    p_reason: parsed.data.reason,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
    p_payment_id: parsed.data.paymentId,
    p_is_final: parsed.data.isFinal,
    p_reference: parsed.data.reference,
    p_comment: parsed.data.comment,
  })
  if (error) return { error: friendly(error), values: kept }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Apurement enregistré.' }
}

export async function cancelSettlementAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId', 'settlementId')
  if (!key) return { error: 'Apurement inconnu.' }
  const parsed = reasonSchema.safeParse({ reason: formText(formData, 'reason') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['reason']) }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_charge_settlement', { p_id: key[2], p_reason: parsed.data.reason })
  if (error) return { error: friendly(error), values: submittedValues(formData, ['reason']) }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Apurement annulé.' }
}

export async function updateSettlementAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'leaseId', 'settlementId')
  if (!key) return { error: 'Apurement inconnu.' }
  const fields = ['settledOn', 'mode', 'reference', 'comment']
  const parsed = updateSettlementSchema(todayInParis()).safeParse(Object.fromEntries(fields.map((k) => [k, formText(formData, k)])))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, fields) }
  const supabase = await createClient()
  const { error } = await supabase.rpc('update_charge_settlement_details', {
    p_id: key[2],
    p_settled_on: parsed.data.settledOn,
    p_mode: parsed.data.mode,
    p_reference: parsed.data.reference,
    p_comment: parsed.data.comment,
  })
  if (error) return { error: friendly(error), values: submittedValues(formData, fields) }
  revalidatePath(leasePath(key[0], key[1]))
  return { success: 'Apurement corrigé.' }
}
