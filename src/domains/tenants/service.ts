import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { GUARANTOR_KINDS, HOUSING_AIDS } from './schemas'

export interface Tenant {
  id: string
  lastName: string
  firstName: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  postalCode: string | null
  city: string | null
  paperDeliveryRequested: boolean
  archivedAt: string | null
}

export interface PrivateDetails {
  birthDate: string | null
  guarantorKind: (typeof GUARANTOR_KINDS)[number]
  guarantorName: string | null
  guarantorContact: string | null
  housingAid: (typeof HOUSING_AIDS)[number]
  note: string | null
}

const COLUMNS = 'id, last_name, first_name, email, phone, address_line1, postal_code, city, paper_delivery_requested, archived_at'

type Row = {
  id: string
  last_name: string
  first_name: string
  email: string | null
  phone: string | null
  address_line1: string | null
  postal_code: string | null
  city: string | null
  paper_delivery_requested: boolean
  archived_at: string | null
}

const toTenant = (r: Row): Tenant => ({
  id: r.id,
  lastName: r.last_name,
  firstName: r.first_name,
  email: r.email,
  phone: r.phone,
  addressLine1: r.address_line1,
  postalCode: r.postal_code,
  city: r.city,
  paperDeliveryRequested: r.paper_delivery_requested,
  archivedAt: r.archived_at,
})

export const tenantName = (t: Pick<Tenant, 'lastName' | 'firstName'>) => `${t.firstName} ${t.lastName}`.trim()

export async function listTenants(entityId: string, includeArchived: boolean): Promise<Tenant[]> {
  const supabase = await createClient()
  let query = supabase.from('tenants').select(COLUMNS).eq('entity_id', entityId).order('last_name').order('first_name')
  if (!includeArchived) query = query.is('archived_at', null)
  const { data } = await query
  return (data ?? []).map((r) => toTenant(r as Row))
}

export async function getTenant(entityId: string, id: string): Promise<Tenant | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('tenants').select(COLUMNS).eq('entity_id', entityId).eq('id', id).maybeSingle()
  return data ? toTenant(data as Row) : null
}

/** Données sensibles : vides pour qui n'a pas la permission (la RLS ne renvoie aucune ligne). */
export async function getPrivateDetails(tenantId: string): Promise<PrivateDetails | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenant_private_details')
    .select('birth_date, guarantor_kind, guarantor_name, guarantor_contact, housing_aid, note')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data) return null
  return {
    birthDate: data.birth_date,
    guarantorKind: data.guarantor_kind,
    guarantorName: data.guarantor_name,
    guarantorContact: data.guarantor_contact,
    housingAid: data.housing_aid,
    note: data.note,
  }
}
