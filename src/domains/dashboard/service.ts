import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface Summary {
  activeProperties: number
  runningLeases: number
  activeTenants: number
  calledCents: number
  collectedCents: number
  expensesCents: number
  refundsNetCents: number
  estimatedBalanceCents: number
  remainingDueCents: number
  overdueCents: number
  overdueCount: number
  overdueMaxDays: number
  toAllocateCents: number
  finalSettlementsPending: number
}

export interface MonthRow {
  month: string
  calledCents: number
  collectedCents: number
  expensesCents: number
}

export interface PropertyRow {
  entityId: string
  entityName: string
  propertyId: string
  propertyLabel: string
  calledCents: number
  collectedCents: number
  overdueCents: number
  expensesCents: number
  refundsNetCents: number
  estimatedBalanceCents: number
}

export interface RecentOperation {
  kind: 'payment' | 'expense' | 'receipt'
  label: string
  detail: string
  amountCents: number
  date: string
  at: string
}

export interface DashboardScope {
  /** null = toutes les structures que l'utilisateur voit. */
  entityIds: string[] | null
  /** null = tous les biens. */
  propertyIds: string[] | null
  from: string
  to: string
}

const n = (v: unknown): number => Number(v ?? 0)

export async function getSummary(scope: DashboardScope): Promise<Summary | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('dashboard_summary', { p_entity_ids: scope.entityIds, p_property_ids: scope.propertyIds, p_from: scope.from, p_to: scope.to }).single()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    activeProperties: n(r.active_properties),
    runningLeases: n(r.running_leases),
    activeTenants: n(r.active_tenants),
    calledCents: n(r.called_cents),
    collectedCents: n(r.collected_cents),
    expensesCents: n(r.expenses_cents),
    refundsNetCents: n(r.refunds_net_cents),
    estimatedBalanceCents: n(r.estimated_balance_cents),
    remainingDueCents: n(r.remaining_due_cents),
    overdueCents: n(r.overdue_cents),
    overdueCount: n(r.overdue_count),
    overdueMaxDays: n(r.overdue_max_days),
    toAllocateCents: n(r.to_allocate_cents),
    finalSettlementsPending: n(r.final_settlements_pending),
  }
}

export async function getMonthly(scope: DashboardScope): Promise<MonthRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('dashboard_monthly', { p_entity_ids: scope.entityIds, p_property_ids: scope.propertyIds, p_from: scope.from, p_to: scope.to })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    month: String(r.month).slice(0, 10),
    calledCents: n(r.called_cents),
    collectedCents: n(r.collected_cents),
    expensesCents: n(r.expenses_cents),
  }))
}

export async function getByProperty(scope: DashboardScope): Promise<PropertyRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('dashboard_by_property', { p_entity_ids: scope.entityIds, p_property_ids: scope.propertyIds, p_from: scope.from, p_to: scope.to })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    entityId: String(r.entity_id),
    entityName: String(r.entity_name),
    propertyId: String(r.property_id),
    propertyLabel: String(r.property_label),
    calledCents: n(r.called_cents),
    collectedCents: n(r.collected_cents),
    overdueCents: n(r.overdue_cents),
    expensesCents: n(r.expenses_cents),
    refundsNetCents: n(r.refunds_net_cents),
    estimatedBalanceCents: n(r.estimated_balance_cents),
  }))
}

export async function listAllProperties(): Promise<{ id: string; label: string; entityId: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('properties').select('id, label, entity_id').is('archived_at', null).order('label')
  return (data ?? []).map((p) => ({ id: p.id, label: p.label, entityId: p.entity_id }))
}

/** Les dix dernières saisies de paiements, de dépenses et de documents émis, tirées des tables métier (pas du journal d'audit). */
export async function getRecentOperations(entityIds: string[] | null): Promise<RecentOperation[]> {
  const supabase = await createClient()
  let paymentsQuery = supabase
    .from('payments')
    .select('amount_cents, received_on, created_at, lease:leases(property:properties(label))')
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
    .limit(10)
  let expensesQuery = supabase
    .from('expenses')
    .select('description, amount_cents, expense_date, created_at, property:properties(label)')
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
    .limit(10)
  let receiptsQuery = supabase
    .from('receipts')
    .select('number, kind, amount_cents, issued_on, issued_at, snapshot')
    .is('cancelled_at', null)
    .order('issued_at', { ascending: false })
    .limit(10)
  if (entityIds) {
    paymentsQuery = paymentsQuery.in('entity_id', entityIds)
    expensesQuery = expensesQuery.in('entity_id', entityIds)
    receiptsQuery = receiptsQuery.in('entity_id', entityIds)
  }
  const [payments, expenses, receipts] = (await Promise.all([paymentsQuery, expensesQuery, receiptsQuery])) as unknown as { data: Record<string, unknown>[] | null }[]
  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null))
  const operations: RecentOperation[] = []
  for (const p of payments.data ?? []) {
    const lease = one<{ property: unknown }>(p.lease)
    const property = one<{ label: string }>(lease?.property)
    operations.push({ kind: 'payment', label: 'Paiement reçu', detail: property?.label ?? '', amountCents: n(p.amount_cents), date: String(p.received_on), at: String(p.created_at) })
  }
  for (const e of expenses.data ?? []) {
    operations.push({
      kind: 'expense',
      label: `Dépense : ${String(e.description)}`,
      detail: one<{ label: string }>(e.property)?.label ?? '',
      amountCents: n(e.amount_cents),
      date: String(e.expense_date),
      at: String(e.created_at),
    })
  }
  for (const r of receipts.data ?? []) {
    const snap = (r.snapshot ?? {}) as { property?: { label?: string } }
    operations.push({
      kind: 'receipt',
      label: `${r.kind === 'quittance' ? 'Quittance' : 'Reçu'} ${String(r.number)}`,
      detail: snap.property?.label ?? '',
      amountCents: n(r.amount_cents),
      date: String(r.issued_on),
      at: String(r.issued_at),
    })
  }
  return operations.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10)
}

/** Demandes de rattachement en attente dans les structures sélectionnées. */
export async function countPendingAccess(entityIds: string[] | null): Promise<number> {
  const supabase = await createClient()
  let query = supabase.from('tenant_access').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (entityIds) query = query.in('entity_id', entityIds)
  const { count } = await query
  return count ?? 0
}
