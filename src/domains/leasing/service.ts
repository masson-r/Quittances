import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { todayInParis } from '@/lib/dates'
import { currentTerm, leaseStatus, type LeaseStatus } from './status'

export interface RentalTerm {
  id: string
  effectiveFrom: string
  rentCents: number
  chargesCents: number
  reason: string | null
}

export interface Presence {
  id: string
  tenantId: string
  tenantName: string
  startDate: string
  endDate: string | null
}

export interface LeaseSummary {
  id: string
  propertyId: string
  propertyLabel: string
  startDate: string
  endDate: string | null
  dueDay: number
  status: LeaseStatus
  rentCents: number
  chargesCents: number
  presentTenants: string[]
  /** Tous les locataires passés ou présents sur le bail, sans doublon. */
  allTenants: string[]
}

export interface LeaseDetail extends LeaseSummary {
  depositCents: number | null
  depositReceivedOn: string | null
  terms: RentalTerm[]
  presences: Presence[]
}

type NameRow = { first_name: string; last_name: string }
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
const fullName = (t: NameRow | null) => (t ? `${t.first_name} ${t.last_name}`.trim() : '')

type LeaseRow = {
  id: string
  property_id: string
  start_date: string
  end_date: string | null
  due_day: number
  deposit_cents: number | null
  deposit_received_on: string | null
  property: { label: string } | { label: string }[] | null
  lease_tenants: { id: string; tenant_id: string; start_date: string; end_date: string | null; tenant: NameRow | NameRow[] | null }[]
  rental_terms: { id: string; effective_from: string; rent_cents: number; charges_cents: number; reason: string | null }[]
}

const SELECT =
  'id, property_id, start_date, end_date, due_day, deposit_cents, deposit_received_on, property:properties(label), ' +
  'lease_tenants(id, tenant_id, start_date, end_date, tenant:tenants(first_name, last_name)), ' +
  'rental_terms(id, effective_from, rent_cents, charges_cents, reason)'

function toDetail(row: LeaseRow, today: string): LeaseDetail {
  const terms: RentalTerm[] = row.rental_terms
    .map((t) => ({ id: t.id, effectiveFrom: t.effective_from, rentCents: t.rent_cents, chargesCents: t.charges_cents, reason: t.reason }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  const presences: Presence[] = row.lease_tenants
    .map((p) => ({ id: p.id, tenantId: p.tenant_id, tenantName: fullName(one(p.tenant)), startDate: p.start_date, endDate: p.end_date }))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
  const term = currentTerm(terms, today)
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyLabel: one(row.property)?.label ?? '',
    startDate: row.start_date,
    endDate: row.end_date,
    dueDay: row.due_day,
    status: leaseStatus(row.start_date, row.end_date, today),
    rentCents: term?.rentCents ?? 0,
    chargesCents: term?.chargesCents ?? 0,
    allTenants: [...new Set(presences.map((p) => p.tenantName))],
    presentTenants: presences.filter((p) => p.startDate <= today && (p.endDate === null || p.endDate >= today)).map((p) => p.tenantName),
    depositCents: row.deposit_cents,
    depositReceivedOn: row.deposit_received_on,
    terms,
    presences,
  }
}

export async function listLeases(entityId: string): Promise<LeaseSummary[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('leases').select(SELECT).eq('entity_id', entityId).order('start_date', { ascending: false })
  const today = todayInParis()
  return ((data ?? []) as unknown as LeaseRow[]).map((r) => toDetail(r, today))
}

export async function listLeasesForProperty(entityId: string, propertyId: string): Promise<LeaseSummary[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('leases').select(SELECT).eq('entity_id', entityId).eq('property_id', propertyId).order('start_date', { ascending: false })
  const today = todayInParis()
  return ((data ?? []) as unknown as LeaseRow[]).map((r) => toDetail(r, today))
}

export async function getLease(entityId: string, id: string): Promise<LeaseDetail | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('leases').select(SELECT).eq('entity_id', entityId).eq('id', id).maybeSingle()
  return data ? toDetail(data as unknown as LeaseRow, todayInParis()) : null
}
