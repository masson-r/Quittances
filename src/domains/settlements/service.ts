import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface SettlementRow {
  id: string
  kind: 'charges_adjustment' | 'unallocated_refund'
  settledOn: string
  amountCents: number
  mode: string
  reason: string
  periodStart: string | null
  periodEnd: string | null
  isFinal: boolean
  reference: string | null
  comment: string | null
  cancelledAt: string | null
  cancellationReason: string | null
}

export interface RefundablePayment {
  id: string
  receivedOn: string
  amountCents: number
  remainingCents: number
}

export async function listSettlements(leaseId: string): Promise<SettlementRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('charge_settlements')
    .select('id, kind, settled_on, amount_cents, mode, reason, period_start, period_end, is_final, reference, comment, cancelled_at, cancellation_reason')
    .eq('lease_id', leaseId)
    .order('settled_on', { ascending: false })
    .order('created_at', { ascending: false })
  return (data ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    settledOn: s.settled_on,
    amountCents: s.amount_cents,
    mode: s.mode,
    reason: s.reason,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    isFinal: s.is_final,
    reference: s.reference,
    comment: s.comment,
    cancelledAt: s.cancelled_at,
    cancellationReason: s.cancellation_reason,
  }))
}

/** Apurement final attendu : le bail est terminé et aucun apurement final actif n'existe. */
export async function finalSettlementMissing(leaseId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.from('lease_settlement_status').select('final_missing').eq('lease_id', leaseId).maybeSingle()
  return data?.final_missing === true
}

/** Paiements du bail avec un reste non affecté (ni affecté ni déjà remboursé). */
export async function listRefundablePayments(leaseId: string): Promise<RefundablePayment[]> {
  const supabase = await createClient()
  const { data: payments } = await supabase.from('payments').select('id, received_on, amount_cents').eq('lease_id', leaseId).is('cancelled_at', null).order('received_on', { ascending: false })
  const ids = (payments ?? []).map((p) => p.id)
  if (ids.length === 0) return []
  const [{ data: allocs }, { data: refunds }] = await Promise.all([
    supabase.from('payment_allocations').select('payment_id, amount_cents').in('payment_id', ids).is('reversed_at', null),
    supabase.from('charge_settlements').select('payment_id, amount_cents').in('payment_id', ids).is('cancelled_at', null),
  ])
  const used = new Map<string, number>()
  for (const row of [...(allocs ?? []), ...(refunds ?? [])]) used.set(row.payment_id, (used.get(row.payment_id) ?? 0) + row.amount_cents)
  return (payments ?? [])
    .map((p) => ({ id: p.id, receivedOn: p.received_on, amountCents: p.amount_cents, remainingCents: p.amount_cents - (used.get(p.id) ?? 0) }))
    .filter((p) => p.remainingCents > 0)
}
