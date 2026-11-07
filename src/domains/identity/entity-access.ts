import 'server-only'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { NAV_ITEMS } from './navigation'
import { getEntityName, myPermissions } from './members-service'
import { requireUser, type CurrentUser } from './session'

export interface SectionAccess {
  user: CurrentUser
  entityId: string
  entityName: string
  permissions: string[]
}

/**
 * Accès à une section de la structure : utilisateur connecté (second facteur compris), identifiant valide
 * et permission de lecture de la section ; sinon page introuvable (on ne révèle pas l'existence d'une structure).
 */
export async function requireSection(entityIdParam: string, slug: string): Promise<SectionAccess> {
  if (!z.uuid().safeParse(entityIdParam).success) notFound()
  const item = NAV_ITEMS.find((i) => i.slug === slug)
  if (!item) notFound()

  const user = await requireUser()
  const permissions = await myPermissions(entityIdParam)
  if (!permissions.includes(item.permission)) notFound()

  const entityName = (await getEntityName(entityIdParam)) ?? ''
  return { user, entityId: entityIdParam, entityName, permissions }
}
