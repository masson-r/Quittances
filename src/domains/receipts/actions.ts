'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, type FormState } from '@/lib/form-state'
import { isValidIsoDate } from '@/lib/dates'
import { requireUser } from '@/domains/identity/session'
import { finalizeReceipt } from './service'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."

function friendly(message: string | undefined): string {
  if (!message) return GENERIC
  const known = [
    'Droit insuffisant',
    'intégralement réglée',
    'déjà émise',
    'déjà émis',
    'soldée',
    'futur',
    'postérieure',
    'motif',
    'déjà annulé',
    'annulée',
    'pas affecté',
  ]
  if (message.includes('Droit insuffisant')) return "Vous n'avez pas le droit d'effectuer cette action."
  return known.some((k) => message.includes(k)) ? message : GENERIC
}

const optionalDate = (value: string): string | null | undefined => (value === '' ? null : isValidIsoDate(value) ? value : undefined)
const path = (entityId: string) => `/espace/${entityId}/quittances`

/** Émet un document (quittance ou reçu partiel), génère son PDF une seule fois et le dépose. */
export async function issueReceiptAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const kind = formText(formData, 'kind')
  const chargeId = formText(formData, 'rentChargeId')
  const paymentId = formText(formData, 'paymentId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(chargeId).success || (kind !== 'quittance' && kind !== 'partial_receipt')) {
    return { error: 'Échéance inconnue.' }
  }
  if (kind === 'partial_receipt' && !uuid.safeParse(paymentId).success) return { error: 'Paiement inconnu.' }
  const issuedOn = optionalDate(formText(formData, 'issuedOn'))
  const paidOn = optionalDate(formText(formData, 'paidOn'))
  if (issuedOn === undefined || paidOn === undefined) return { error: 'Saisissez des dates valides.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('issue_receipt', { p_kind: kind, p_charge_id: chargeId, p_payment_id: kind === 'partial_receipt' ? paymentId : null, p_issued_on: issuedOn, p_paid_on: paidOn })
    .single()
  if (error || !data) return { error: friendly(error?.message) }
  const { id, number } = data as { id: string; number: string }

  const stored = await finalizeReceipt(id)
  revalidatePath(path(entityId))
  if (!stored.ok) return { error: `Document ${number} émis, mais : ${stored.error}` }
  return { success: `Document ${number} émis.` }
}

/** Reprend la génération du PDF d'un document émis dont le fichier n'a pas pu être déposé. */
export async function finalizeReceiptAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const id = formText(formData, 'receiptId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(id).success) return { error: 'Document inconnu.' }
  const result = await finalizeReceipt(id)
  revalidatePath(path(entityId))
  return result.ok ? { success: 'Fichier généré.' } : { error: result.error }
}

export async function cancelReceiptAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const id = formText(formData, 'receiptId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(id).success) return { error: 'Document inconnu.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_receipt', { p_id: id, p_reason: formText(formData, 'reason') })
  if (error) return { error: friendly(error.message) }
  revalidatePath(path(entityId))
  return { success: 'Document annulé.' }
}

/** Annule un document et en émet un nouveau (version suivante), dont le PDF est généré une fois. */
export async function replaceReceiptAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const id = formText(formData, 'receiptId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(id).success) return { error: 'Document inconnu.' }
  const issuedOn = optionalDate(formText(formData, 'issuedOn'))
  const paidOn = optionalDate(formText(formData, 'paidOn'))
  if (issuedOn === undefined || paidOn === undefined) return { error: 'Saisissez des dates valides.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('replace_receipt', { p_id: id, p_reason: formText(formData, 'reason'), p_issued_on: issuedOn, p_paid_on: paidOn }).single()
  if (error || !data) return { error: friendly(error?.message) }
  const { id: newId, number } = data as { id: string; number: string }
  const stored = await finalizeReceipt(newId)
  revalidatePath(path(entityId))
  if (!stored.ok) return { error: `Document ${number} émis, mais : ${stored.error}` }
  return { success: `Document remplacé par ${number}.` }
}
