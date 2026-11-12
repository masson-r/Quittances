import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface Category {
  id: string
  name: string
  archivedAt: string | null
}

export interface ExpenseRow {
  id: string
  propertyId: string
  propertyLabel: string
  categoryId: string
  categoryName: string
  expenseDate: string
  description: string
  amountCents: number
  recoverable: boolean
  documentId: string | null
  cancelledAt: string | null
  cancellationReason: string | null
}

export interface ExpenseFilters {
  propertyId?: string
  categoryId?: string
  from?: string
  to?: string
  includeCancelled?: boolean
}

export async function listCategories(entityId: string, includeArchived = false): Promise<Category[]> {
  const supabase = await createClient()
  let query = supabase.from('expense_categories').select('id, name, archived_at').eq('entity_id', entityId).order('name')
  if (!includeArchived) query = query.is('archived_at', null)
  const { data } = await query
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, archivedAt: c.archived_at }))
}

export async function listExpenses(entityId: string, filters: ExpenseFilters): Promise<ExpenseRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('expenses')
    .select(
      'id, property_id, category_id, expense_date, description, amount_cents, recoverable, document_id, cancelled_at, cancellation_reason, property:properties(label), category:expense_categories(name)',
    )
    .eq('entity_id', entityId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.from) query = query.gte('expense_date', filters.from)
  if (filters.to) query = query.lte('expense_date', filters.to)
  if (!filters.includeCancelled) query = query.is('cancelled_at', null)
  const { data } = await query
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  return (data ?? []).map((e) => ({
    id: e.id,
    propertyId: e.property_id,
    propertyLabel: one(e.property as { label: string } | { label: string }[] | null)?.label ?? '',
    categoryId: e.category_id,
    categoryName: one(e.category as { name: string } | { name: string }[] | null)?.name ?? '',
    expenseDate: e.expense_date,
    description: e.description,
    amountCents: e.amount_cents,
    recoverable: e.recoverable,
    documentId: e.document_id,
    cancelledAt: e.cancelled_at,
    cancellationReason: e.cancellation_reason,
  }))
}
