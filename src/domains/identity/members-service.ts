import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { MemberStatus, Role } from './roles'

export interface MemberRow {
  id: string
  role: Role
  status: MemberStatus
  profileId: string
  name: string
  email: string
}

export interface PendingInvitation {
  id: string
  email: string
  role: Role
  createdAt: string
  expiresAt: string
}

export interface MyMembership {
  role: Role
  entityId: string
  entityName: string
}

type Profile = { first_name: string; last_name: string; email: string }

/** Droit de l'utilisateur connecté sur une structure (la base décide ; second facteur compris). */
export async function hasPermission(entityId: string, permission: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('has_permission', { p_entity_id: entityId, p_permission: permission })
  return data === true
}

export async function getEntityName(entityId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('ownership_entities').select('name').eq('id', entityId).maybeSingle()
  return data?.name ?? null
}

export async function listMembers(entityId: string): Promise<MemberRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('entity_memberships')
    .select('id, role, status, profile_id, profile:profiles(first_name, last_name, email)')
    .eq('entity_id', entityId)
    .order('created_at')
  return (data ?? []).map((m) => {
    const profile = (Array.isArray(m.profile) ? m.profile[0] : m.profile) as Profile | null
    return {
      id: m.id,
      role: m.role as Role,
      status: m.status as MemberStatus,
      profileId: m.profile_id,
      name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : '',
      email: profile?.email ?? '',
    }
  })
}

export async function listPendingInvitations(entityId: string): Promise<PendingInvitation[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('entity_id', entityId)
    .eq('kind', 'member')
    .is('used_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  return (data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as Role,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }))
}

/** Structures dont l'utilisateur est membre actif. */
export async function listMyMemberships(userId: string): Promise<MyMembership[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('entity_memberships')
    .select('role, entity:ownership_entities(id, name)')
    .eq('profile_id', userId)
    .eq('status', 'active')
  return (data ?? []).flatMap((m) => {
    const entity = (Array.isArray(m.entity) ? m.entity[0] : m.entity) as { id: string; name: string } | null
    return entity ? [{ role: m.role as Role, entityId: entity.id, entityName: entity.name }] : []
  })
}

/** Permissions de l'utilisateur connecté dans une structure (vide s'il n'en est pas membre actif ou sans second facteur). */
export async function myPermissions(entityId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('my_permissions', { p_entity_id: entityId })
  return Array.isArray(data) ? (data as string[]) : []
}
