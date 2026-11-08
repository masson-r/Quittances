import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type AccessStatus = 'pending' | 'active' | 'refused' | 'revoked' | 'expired'

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  pending: 'En attente de validation',
  active: 'Validée',
  refused: 'Refusée',
  revoked: 'Révoquée',
  expired: 'Expirée',
}

export interface MyRequest {
  id: string
  entityName: string
  status: AccessStatus
  requestedAt: string
  decidedAt: string | null
  endedAt: string | null
  consentWithdrawnAt: string | null
}

export interface MyDossier {
  accessId: string
  tenantId: string
  entityName: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  postalCode: string | null
  city: string | null
  consentWithdrawnAt: string | null
}

export interface MyLease {
  tenantId: string
  leaseId: string
  propertyLabel: string
  address: string
  startDate: string
  endDate: string | null
  rentCents: number | null
  chargesCents: number | null
}

export interface AccessOverviewRow {
  id: string
  tenantId: string
  tenantName: string
  tenantEmail: string | null
  accountEmail: string
  emailMismatch: boolean
  status: AccessStatus
  requestedAt: string
  decidedAt: string | null
  endedAt: string | null
  consentWithdrawnAt: string | null
}

type Row = Record<string, string | number | boolean | null>

export async function listMyRequests(): Promise<MyRequest[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('my_tenant_access')
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string,
    entityName: r.entity_name as string,
    status: r.status as AccessStatus,
    requestedAt: r.requested_at as string,
    decidedAt: r.decided_at as string | null,
    endedAt: r.ended_at as string | null,
    consentWithdrawnAt: r.consent_withdrawn_at as string | null,
  }))
}

export async function listMyDossiers(): Promise<MyDossier[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('my_tenant_dossiers')
  return ((data ?? []) as Row[]).map((r) => ({
    accessId: r.access_id as string,
    tenantId: r.tenant_id as string,
    entityName: r.entity_name as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: r.email as string | null,
    phone: r.phone as string | null,
    addressLine1: r.address_line1 as string | null,
    postalCode: r.postal_code as string | null,
    city: r.city as string | null,
    consentWithdrawnAt: r.consent_withdrawn_at as string | null,
  }))
}

export async function listMyLeases(): Promise<MyLease[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('my_tenant_leases')
  return ((data ?? []) as Row[]).map((r) => ({
    tenantId: r.tenant_id as string,
    leaseId: r.lease_id as string,
    propertyLabel: r.property_label as string,
    address: [r.address_line1, r.postal_code, r.city].filter(Boolean).join(' '),
    startDate: r.start_date as string,
    endDate: r.end_date as string | null,
    rentCents: r.rent_cents as number | null,
    chargesCents: r.charges_cents as number | null,
  }))
}

/** Rattachements d'une structure, avec e-mail du compte (droit tenant:write relu en base). */
export async function listAccessOverview(entityId: string): Promise<AccessOverviewRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('tenant_access_overview', { p_entity_id: entityId })
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    tenantName: r.tenant_name as string,
    tenantEmail: r.tenant_email as string | null,
    accountEmail: r.account_email as string,
    emailMismatch: r.email_mismatch === true,
    status: r.status as AccessStatus,
    requestedAt: r.requested_at as string,
    decidedAt: r.decided_at as string | null,
    endedAt: r.ended_at as string | null,
    consentWithdrawnAt: r.consent_withdrawn_at as string | null,
  }))
}
