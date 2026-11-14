'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { moveAllocationSchema, reasonSchema, recordPaymentSchema, updatePaymentSchema } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const base = (entityId: string) => `/espace/${entityId}/paiements`

function ids(formData: FormData, ...keys: string[]): string[] | null {
  const values = keys.map((k) => formText(formData, k))
  return values.every((v) => uuid.safeParse(v).success) ? values : null
}

/** Messages en français pour les refus que la base lève volontairement. */
function friendly(error: { code?: string; message?: string }): string {
  const message = error.message ?? ''
  if (error.code === '42501' || message.includes('Droit insuffisant')) return DENIED
  const known = [
    'dépassent le montant',
    'doit être positif',
    'Confirmation requise',
    'dans le futur',
    'motif est obligatoire',
    'déjà annulé',
    'déjà retirée',
    'introuvable pour ce bail',
    'affectations actives',
    'la même',
    'annulée',
    'annulé',
    'Aucune condition',
    'Un document émis',
  ]
  return known.some((k) => message.includes(k)) ? message.replace(/^.*?(?=[A-ZÉÀ])/, '') : GENERIC
}

/** Affectations saisies : champs `alloc_<identifiant d'échéance>` en euros. */
function allocationFields(formData: FormData): { rentChargeId: string; amount: string }[] {
  return [...formData.entries()]
    .filter(([key]) => key.startsWith('alloc_'))
    .map(([key, value]) => ({ rentChargeId: key.slice('alloc_'.length), amount: String(value) }))
}

const PAYMENT_KEYS = ['leaseId', 'amount', 'receivedOn', 'mode', 'reference', 'comment']

export async function recordPaymentAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entity = ids(formData, 'entityId')
  if (!entity) return { error: 'Structure inconnue.' }
  const allocations = allocationFields(formData)
  const kept = { ...submittedValues(formData, PAYMENT_KEYS), ...Object.fromEntries(allocations.map((a) => [`alloc_${a.rentChargeId}`, a.amount])) }
  const parsed = recordPaymentSchema.safeParse({
    ...Object.fromEntries(PAYMENT_KEYS.map((k) => [k, formText(formData, k)])),
    confirmCash: formData.get('confirmCash') === 'on',
    allocations,
  })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: kept }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_payment', {
    p_lease_id: parsed.data.leaseId,
    p_amount_cents: parsed.data.amountCents,
    p_received_on: parsed.data.receivedOn,
    p_mode: parsed.data.mode,
    p_reference: parsed.data.reference,
    p_comment: parsed.data.comment,
    p_allocations: parsed.data.allocations.map((a) => ({ rent_charge_id: a.rentChargeId, amount_cents: a.amountCents })),
    p_confirm_cash: parsed.data.confirmCash,
  })
  if (error || !data) return { error: friendly(error ?? {}), values: kept }
  revalidatePath(base(entity[0]))
  redirect(`${base(entity[0])}/${data as string}`)
}

export async function updatePaymentAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'paymentId')
  if (!key) return { error: 'Paiement inconnu.' }
  const keys = ['reference', 'comment', 'mode', 'receivedOn']
  const parsed = updatePaymentSchema.safeParse(Object.fromEntries(keys.map((k) => [k, formText(formData, k)])))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, keys) }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_payment_details', {
    p_payment_id: key[1],
    p_reference: parsed.data.reference,
    p_comment: parsed.data.comment,
    p_mode: parsed.data.mode,
    p_received_on: parsed.data.receivedOn,
  })
  if (error) return { error: friendly(error), values: submittedValues(formData, keys) }
  revalidatePath(`${base(key[0])}/${key[1]}`)
  return { success: 'Paiement corrigé.' }
}

async function withReason(formData: FormData, ids_: string[], run: (reason: string) => Promise<{ error: { code?: string; message?: string } | null }>, done: string, paths: string[]): Promise<FormState> {
  const parsed = reasonSchema.safeParse({ reason: formText(formData, 'reason') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['reason']) }
  const { error } = await run(parsed.data.reason)
  if (error) return { error: friendly(error), values: submittedValues(formData, ['reason']) }
  for (const p of paths) revalidatePath(p)
  void ids_
  return { success: done }
}

export async function cancelPaymentAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'paymentId')
  if (!key) return { error: 'Paiement inconnu.' }
  const supabase = await createClient()
  return withReason(formData, key, async (reason) => supabase.rpc('cancel_payment', { p_payment_id: key[1], p_reason: reason }), 'Paiement annulé.', [base(key[0]), `${base(key[0])}/${key[1]}`])
}

export async function reverseAllocationAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'paymentId', 'allocationId')
  if (!key) return { error: 'Affectation inconnue.' }
  const supabase = await createClient()
  return withReason(formData, key, async (reason) => supabase.rpc('reverse_allocation', { p_allocation_id: key[2], p_reason: reason }), 'Affectation retirée.', [base(key[0]), `${base(key[0])}/${key[1]}`])
}

export async function moveAllocationAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'paymentId', 'allocationId')
  if (!key) return { error: 'Affectation inconnue.' }
  const parsed = moveAllocationSchema.safeParse({ chargeId: formText(formData, 'chargeId'), reason: formText(formData, 'reason') })
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, ['chargeId', 'reason']) }
  const supabase = await createClient()
  const { error } = await supabase.rpc('move_allocation', { p_allocation_id: key[2], p_new_charge_id: parsed.data.chargeId, p_reason: parsed.data.reason })
  if (error) return { error: friendly(error), values: submittedValues(formData, ['chargeId', 'reason']) }
  revalidatePath(base(key[0]))
  revalidatePath(`${base(key[0])}/${key[1]}`)
  return { success: 'Affectation déplacée.' }
}

/** Affecte le reste non affecté d'un paiement (par exemple un paiement en avance une fois l'échéance créée). */
export async function allocateRemainingAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'paymentId')
  if (!key) return { error: 'Paiement inconnu.' }
  const allocations = allocationFields(formData)
    .map((a) => ({ rent_charge_id: a.rentChargeId, amount_cents: Math.round(Number(a.amount.replace(',', '.')) * 100) }))
    .filter((a) => Number.isFinite(a.amount_cents) && a.amount_cents > 0)
  if (allocations.length === 0) return { error: 'Saisissez au moins un montant à affecter.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('allocate_payment', { p_payment_id: key[1], p_allocations: allocations })
  if (error) return { error: friendly(error) }
  revalidatePath(base(key[0]))
  revalidatePath(`${base(key[0])}/${key[1]}`)
  return { success: 'Affectation enregistrée.' }
}

export async function recalcChargeAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'chargeId')
  if (!key) return { error: 'Échéance inconnue.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('recalc_rent_charge', { p_charge_id: key[1] })
  if (error) return { error: friendly(error) }
  revalidatePath(base(key[0]))
  return { success: 'Échéance recalculée.' }
}

export async function cancelChargeAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const key = ids(formData, 'entityId', 'chargeId')
  if (!key) return { error: 'Échéance inconnue.' }
  const supabase = await createClient()
  return withReason(formData, key, async (reason) => supabase.rpc('cancel_rent_charge', { p_charge_id: key[1], p_reason: reason }), 'Échéance annulée.', [base(key[0])])
}
