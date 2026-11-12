import 'server-only'
import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { receiptPath, storeReceiptPdf } from '@/lib/storage/private-buckets'
import { byteaToBuffer } from '@/domains/signatures/service'
import { buildReceiptPdf, type SignatureBytes } from './pdf'
import { receiptSnapshotSchema } from './snapshot'

export type ReceiptKind = 'quittance' | 'partial_receipt'

export interface ReceiptRow {
  id: string
  kind: ReceiptKind
  number: string
  version: number
  periodStart: string
  periodEnd: string
  amountCents: number
  issuedOn: string
  tenants: string[]
  propertyLabel: string
  hasFile: boolean
  cancelledAt: string | null
  cancellationReason: string | null
}

export interface Issuable {
  kind: ReceiptKind
  rentChargeId: string
  paymentId: string | null
  label: string
  periodStart: string
  periodEnd: string
  amountCents: number
  defaultPaidOn: string | null
}

export const KIND_LABELS: Record<ReceiptKind, string> = { quittance: 'Quittance', partial_receipt: 'Reçu partiel' }

/**
 * Génère le PDF d'un document déjà émis (jamais déposé), le dépose dans le bucket privé et enregistre son empreinte.
 * Uniquement à partir de l'instantané figé en base. En cas d'échec le document reste « à finaliser » et peut être repris.
 */
export async function finalizeReceipt(receiptId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('receipts')
    .select('id, entity_id, snapshot, signature_id, file_path, cancelled_at')
    .eq('id', receiptId)
    .maybeSingle()
  if (!row) return { ok: false, error: 'Document introuvable.' }
  if (row.file_path) return { ok: false, error: 'Le fichier de ce document est déjà enregistré.' }
  if (row.cancelled_at) return { ok: false, error: 'Ce document est annulé.' }

  const snapshot = receiptSnapshotSchema.safeParse(row.snapshot)
  if (!snapshot.success) return { ok: false, error: "L'instantané du document est illisible." }

  let signature: SignatureBytes | null = null
  if (row.signature_id) {
    const { data } = await supabase.from('member_signatures').select('content_type, image').eq('id', row.signature_id).maybeSingle()
    if (data) signature = { contentType: data.content_type as SignatureBytes['contentType'], bytes: byteaToBuffer(data.image as string) }
  }

  try {
    const bytes = await buildReceiptPdf(snapshot.data, signature)
    const path = receiptPath(row.entity_id, row.id)
    await storeReceiptPdf(path, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const { error } = await supabase.rpc('attach_receipt_file', { p_id: row.id, p_path: path, p_sha256: sha256, p_size: bytes.length })
    if (error) return { ok: false, error: "Le fichier est déposé mais son empreinte n'a pas pu être enregistrée." }
  } catch {
    return { ok: false, error: 'La génération du PDF a échoué. Le document est émis : finalisez-le depuis la liste.' }
  }
  return { ok: true }
}

export async function listReceipts(entityId: string): Promise<ReceiptRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('receipts')
    .select('id, kind, number, version, period_start, period_end, amount_cents, issued_on, snapshot, file_path, cancelled_at, cancellation_reason')
    .eq('entity_id', entityId)
    .order('issued_on', { ascending: false })
    .order('number', { ascending: false })
  return (data ?? []).map((r) => {
    const snap = (r.snapshot ?? {}) as { tenants?: string[]; property?: { label?: string } }
    return {
      id: r.id,
      kind: r.kind as ReceiptKind,
      number: r.number,
      version: r.version,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      amountCents: r.amount_cents,
      issuedOn: r.issued_on,
      tenants: snap.tenants ?? [],
      propertyLabel: snap.property?.label ?? '',
      hasFile: r.file_path !== null,
      cancelledAt: r.cancelled_at,
      cancellationReason: r.cancellation_reason,
    }
  })
}

/** Documents qu'on peut émettre : quittance d'une échéance soldée, reçu d'un paiement partiel affecté. */
export async function listIssuable(entityId: string): Promise<Issuable[]> {
  const supabase = await createClient()
  const [{ data: charges }, { data: active }, { data: allocations }, { data: leases }] = await Promise.all([
    supabase
      .from('rent_charge_balances')
      .select('id, lease_id, period_start, period_end, total_cents, paid_cents, status')
      .eq('entity_id', entityId)
      .neq('status', 'cancelled')
      .gt('paid_cents', 0)
      .order('period_start', { ascending: false }),
    supabase.from('receipts').select('kind, rent_charge_id, payment_id').eq('entity_id', entityId).is('cancelled_at', null),
    supabase
      .from('payment_allocations')
      .select('rent_charge_id, payment_id, amount_cents, payment:payments(received_on, cancelled_at)')
      .eq('entity_id', entityId)
      .is('reversed_at', null),
    supabase.from('leases').select('id, property:properties(label)').eq('entity_id', entityId),
  ])

  const label = new Map((leases ?? []).map((l) => [l.id, (Array.isArray(l.property) ? l.property[0] : l.property)?.label ?? 'Bail']))
  const quittances = new Set((active ?? []).filter((r) => r.kind === 'quittance').map((r) => r.rent_charge_id))
  const partials = new Set((active ?? []).filter((r) => r.kind === 'partial_receipt').map((r) => `${r.payment_id}:${r.rent_charge_id}`))
  type Payment = { received_on: string; cancelled_at: string | null }
  const result: Issuable[] = []

  for (const c of charges ?? []) {
    const own = (allocations ?? []).filter((a) => a.rent_charge_id === c.id)
    const base = { rentChargeId: c.id, label: label.get(c.lease_id) ?? 'Bail', periodStart: c.period_start, periodEnd: c.period_end }
    const paymentOf = (a: (typeof own)[number]) => (Array.isArray(a.payment) ? a.payment[0] : a.payment) as Payment | null
    if (c.status === 'paid') {
      if (quittances.has(c.id)) continue
      const dates = own.map((a) => paymentOf(a)?.received_on).filter((d): d is string => Boolean(d))
      result.push({ ...base, kind: 'quittance', paymentId: null, amountCents: c.total_cents, defaultPaidOn: dates.sort().at(-1) ?? null })
    } else {
      const byPayment = new Map<string, { amount: number; on: string }>()
      for (const a of own) {
        const p = paymentOf(a)
        if (!p || p.cancelled_at) continue
        const prev = byPayment.get(a.payment_id)
        byPayment.set(a.payment_id, { amount: (prev?.amount ?? 0) + a.amount_cents, on: p.received_on })
      }
      for (const [paymentId, v] of byPayment) {
        if (partials.has(`${paymentId}:${c.id}`)) continue
        result.push({ ...base, kind: 'partial_receipt', paymentId, amountCents: v.amount, defaultPaidOn: v.on })
      }
    }
  }
  return result
}
