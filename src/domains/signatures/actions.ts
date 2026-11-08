'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { prepareSignatureImage, SignatureImageError } from './image'

const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'enregistrer une signature dans cette structure."
const pagePath = (entityId: string) => `/espace/${entityId}/ma-signature`

/** Téléverse ou remplace la signature de l'utilisateur connecté (la sienne seulement). */
export async function uploadSignatureAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  if (!z.uuid().safeParse(entityId).success) return { error: 'Structure inconnue.' }
  const file = formData.get('signature')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choisissez une image.' }
  if (file.size > 600 * 1024) return { error: "L'image dépasse 500 Ko." }

  let image
  try {
    image = prepareSignatureImage(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    if (error instanceof SignatureImageError) return { error: error.message }
    throw error
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('save_my_signature', {
    p_entity_id: entityId,
    p_content_type: image.contentType,
    p_width: image.width,
    p_height: image.height,
    p_image: `\\x${Buffer.from(image.bytes).toString('hex')}`,
  })
  if (error) return { error: error.code === '42501' ? DENIED : GENERIC }
  revalidatePath(pagePath(entityId))
  return { success: 'Signature enregistrée.' }
}

export async function removeSignatureAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  if (!z.uuid().safeParse(entityId).success) return { error: 'Structure inconnue.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('remove_my_signature', { p_entity_id: entityId })
  if (error) return { error: error.message.includes('Aucune signature') ? 'Aucune signature à retirer.' : GENERIC }
  revalidatePath(pagePath(entityId))
  return { success: 'Signature retirée. Les documents déjà émis ne changent pas.' }
}
