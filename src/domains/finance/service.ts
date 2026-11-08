import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { DisplayStatus } from './labels'

export interface ChargeRow {
  id: string
  leaseId: string
  leaseLabel: string
  periodStart: string
  dueOn: string
  rentCents: number
  chargesCents: number
  totalCents: number
  paidCents: number
  balanceCents: number
  status: DisplayStatus
}

export interface LeaseOption {
  id: string
  label: string
}

export interface PaymentRow {
  id: string
  leaseId: string
  leaseLabel: string
  amountCents: number
  allocatedCents: number
  receivedOn: string
  mode: string
  reference: string | null
  comment: string | null
  cancelledAt: string | null
  cancellationReason: string | null
}

export interface AllocationRow {
  id: string
  rentChargeId: string
  periodStart: string
  dueOn: string
  amountCents: number
  reversedAt: string | null
  reversalReason: string | null
}

type Named = { label: string } | { label: string }[] | null
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/** Libellé d'un bail : le bien, puis les locataires présents ou passés. */
async function leaseLabels(entityId: string): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('leases')
    .select('id, property:properties(label), lease_tenants(tenant:tenants(first_name, last_name))')
    .eq('entity_id', entityId)
  const labels = new Map<string, string>()
  for (const l of (data ?? []) as unknown as { id: string; property: Named; lease_tenants: { tenant: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null }[] }[]) {
    const names = [...new Set(l.lease_tenants.map((p) => one(p.tenant)).filter((t): t is { first_name: string; last_name: string } => t !== null).map((t) => `${t.first_name} ${t.last_name}`.trim()))]
    labels.set(l.id, `${one(l.property)?.label ?? 'Bail'}${names.length ? ` — ${names.join(', ')}` : ''}`)
  }
  return labels
}

export async function listLeaseOptions(entityId: string): Promise<LeaseOption[]> {
  const labels = await leaseLabels(entityId)
  return [...labels.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

export async function listCharges(entityId: string, o: { leaseId?: string | null; includeCancelled?: boolean; openOnly?: boolean } = {}): Promise<ChargeRow[]> {
  const supabase = await createClient()
  let query = supabase.from('rent_charge_balances').select('*').eq('entity_id', entityId).order('due_on', { ascending: false })
  if (o.leaseId) query = query.eq('lease_id', o.leaseId)
  if (!o.includeCancelled) query = query.neq('status', 'cancelled')
  if (o.openOnly) query = query.gt('balance_cents', 0).neq('status', 'cancelled')
  const [{ data }, labels] = await Promise.all([query, leaseLabels(entityId)])
  return (data ?? []).map((r) => ({
    id: r.id,
    leaseId: r.lease_id,
    leaseLabel: labels.get(r.lease_id) ?? 'Bail',
    periodStart: r.period_start,
    dueOn: r.due_on,
    rentCents: r.rent_cents,
    chargesCents: r.charges_cents,
    totalCents: r.total_cents,
    paidCents: r.paid_cents,
    balanceCents: r.balance_cents,
    status: r.status as DisplayStatus,
  }))
}

async function allocatedByPayment(paymentIds: string[]): Promise<Map<string, number>> {
  const sums = new Map<string, number>()
  if (paymentIds.length === 0) return sums
  const supabase = await createClient()
  const { data } = await supabase.from('payment_allocations').select('payment_id, amount_cents').in('payment_id', paymentIds).is('reversed_at', null)
  for (const a of data ?? []) sums.set(a.payment_id, (sums.get(a.payment_id) ?? 0) + a.amount_cents)
  return sums
}

const PAYMENT_COLUMNS = 'id, lease_id, amount_cents, received_on, mode, reference, comment, cancelled_at, cancellation_reason'
type PaymentDb = {
  id: string
  lease_id: string
  amount_cents: number
  received_on: string
  mode: string
  reference: string | null
  comment: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
}

async function toPayments(entityId: string, rows: PaymentDb[]): Promise<PaymentRow[]> {
  const [labels, sums] = await Promise.all([leaseLabels(entityId), allocatedByPayment(rows.map((r) => r.id))])
  return rows.map((r) => ({
    id: r.id,
    leaseId: r.lease_id,
    leaseLabel: labels.get(r.lease_id) ?? 'Bail',
    amountCents: r.amount_cents,
    allocatedCents: sums.get(r.id) ?? 0,
    receivedOn: r.received_on,
    mode: r.mode,
    reference: r.reference,
    comment: r.comment,
    cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,
  }))
}

export async function listPayments(entityId: string, o: { leaseId?: string | null; limit?: number } = {}): Promise<PaymentRow[]> {
  const supabase = await createClient()
  let query = supabase.from('payments').select(PAYMENT_COLUMNS).eq('entity_id', entityId).order('received_on', { ascending: false }).order('created_at', { ascending: false }).limit(o.limit ?? 50)
  if (o.leaseId) query = query.eq('lease_id', o.leaseId)
  const { data } = await query
  return toPayments(entityId, (data ?? []) as PaymentDb[])
}

export async function getPayment(entityId: string, id: string): Promise<{ payment: PaymentRow; allocations: AllocationRow[] } | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('payments').select(PAYMENT_COLUMNS).eq('entity_id', entityId).eq('id', id).maybeSingle()
  if (!data) return null
  const [payment] = await toPayments(entityId, [data as PaymentDb])
  const { data: allocs } = await supabase
    .from('payment_allocations')
    .select('id, rent_charge_id, amount_cents, reversed_at, reversal_reason, charge:rent_charges(period_start, due_on)')
    .eq('payment_id', id)
    .order('created_at')
  const allocations = ((allocs ?? []) as unknown as { id: string; rent_charge_id: string; amount_cents: number; reversed_at: string | null; reversal_reason: string | null; charge: { period_start: string; due_on: string } | { period_start: string; due_on: string }[] | null }[]).map((a) => ({
    id: a.id,
    rentChargeId: a.rent_charge_id,
    periodStart: one(a.charge)?.period_start ?? '',
    dueOn: one(a.charge)?.due_on ?? '',
    amountCents: a.amount_cents,
    reversedAt: a.reversed_at,
    reversalReason: a.reversal_reason,
  }))
  return { payment, allocations }
}
