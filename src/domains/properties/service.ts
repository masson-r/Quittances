import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface Property {
  id: string
  label: string
  addressLine1: string
  addressLine2: string | null
  postalCode: string
  city: string
  description: string | null
  archivedAt: string | null
}

export interface MaintenanceNote {
  id: string
  notedOn: string
  body: string
  authorName: string
}

export interface AccessCode {
  id: string
  label: string
  code: string
  note: string | null
}

const COLUMNS = 'id, label, address_line1, address_line2, postal_code, city, description, archived_at'

type Row = {
  id: string
  label: string
  address_line1: string
  address_line2: string | null
  postal_code: string
  city: string
  description: string | null
  archived_at: string | null
}

const toProperty = (r: Row): Property => ({
  id: r.id,
  label: r.label,
  addressLine1: r.address_line1,
  addressLine2: r.address_line2,
  postalCode: r.postal_code,
  city: r.city,
  description: r.description,
  archivedAt: r.archived_at,
})

export async function listProperties(entityId: string, includeArchived: boolean): Promise<Property[]> {
  const supabase = await createClient()
  let query = supabase.from('properties').select(COLUMNS).eq('entity_id', entityId).order('label')
  if (!includeArchived) query = query.is('archived_at', null)
  const { data } = await query
  return (data ?? []).map((r) => toProperty(r as Row))
}

export async function getProperty(entityId: string, id: string): Promise<Property | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('properties').select(COLUMNS).eq('entity_id', entityId).eq('id', id).maybeSingle()
  return data ? toProperty(data as Row) : null
}

export async function listNotes(propertyId: string): Promise<MaintenanceNote[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('property_maintenance_notes')
    .select('id, noted_on, body, author:profiles(first_name, last_name)')
    .eq('property_id', propertyId)
    .order('noted_on', { ascending: false })
    .order('created_at', { ascending: false })
  return (data ?? []).map((n) => {
    const author = (Array.isArray(n.author) ? n.author[0] : n.author) as { first_name: string; last_name: string } | null
    return { id: n.id, notedOn: n.noted_on, body: n.body, authorName: author ? `${author.first_name} ${author.last_name}`.trim() : '' }
  })
}

export async function listAccessCodes(propertyId: string): Promise<AccessCode[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('property_access_codes').select('id, label, code, note').eq('property_id', propertyId).order('label')
  return (data ?? []).map((c) => ({ id: c.id, label: c.label, code: c.code, note: c.note }))
}
