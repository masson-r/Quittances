'use server'

import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formText, submittedValues, zodFieldErrors, type FormState } from '@/lib/form-state'
import { requireUser } from '@/domains/identity/session'
import { documentPath, removeDocument, storeDocument } from '@/lib/storage/private-buckets'
import { categoryNameSchema, expenseSchema, MAX_DOCUMENT_BYTES, sniffDocumentType } from './schemas'

const uuid = z.uuid()
const GENERIC = "L'opération a échoué. Réessayez dans quelques instants."
const DENIED = "Vous n'avez pas le droit d'effectuer cette action."
const FIELDS = ['propertyId', 'categoryId', 'expenseDate', 'description', 'amount']
const path = (entityId: string) => `/espace/${entityId}/depenses`

function friendly(error: { code?: string; message?: string } | null): string {
  if (!error) return GENERIC
  if (error.code === '42501' || error.message?.includes('Droit insuffisant')) return DENIED
  if (error.message?.includes('futur')) return 'La date ne peut pas être dans le futur.'
  if (error.message?.includes('annulée')) return 'Cette dépense est annulée.'
  if (error.message?.includes('motif')) return 'Le motif est obligatoire.'
  if (error.code === '23505') return 'Une catégorie active porte déjà ce nom.'
  return GENERIC
}

const fields = (formData: FormData) => ({
  ...Object.fromEntries(FIELDS.map((k) => [k, formText(formData, k)])),
  recoverable: formData.get('recoverable') === 'on',
})

/**
 * Dépose le justificatif (si fourni) puis enregistre ses métadonnées. Le fichier part d'abord : en cas d'échec de
 * l'enregistrement, il est retiré (les lignes de `documents` ne se suppriment jamais, un fichier orphelin n'a pas de ligne).
 */
async function attachDocument(entityId: string, file: File): Promise<{ id: string } | { error: string }> {
  if (file.size > MAX_DOCUMENT_BYTES) return { error: 'Le justificatif dépasse 5 Mo.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffDocumentType(bytes)
  if (!type) return { error: 'Le justificatif doit être un PDF, un PNG ou un JPEG.' }

  const id = randomUUID()
  const filePath = documentPath(entityId, id)
  try {
    await storeDocument(filePath, bytes, type)
  } catch {
    return { error: GENERIC }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('documents').insert({
    id,
    entity_id: entityId,
    file_path: filePath,
    content_type: type,
    byte_size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    original_name: (file.name || 'justificatif').slice(0, 200),
  })
  if (error) {
    await removeDocument(filePath).catch(() => {})
    return { error: friendly(error) }
  }
  return { id }
}

const uploaded = (formData: FormData): File | null => {
  const file = formData.get('document')
  return file instanceof File && file.size > 0 ? file : null
}

export async function createExpenseAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  if (!uuid.safeParse(entityId).success) return { error: 'Structure inconnue.' }
  const parsed = expenseSchema.safeParse(fields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, FIELDS) }

  let documentId: string | null = null
  const file = uploaded(formData)
  if (file) {
    const result = await attachDocument(entityId, file)
    if ('error' in result) return { error: result.error, values: submittedValues(formData, FIELDS) }
    documentId = result.id
  }

  const supabase = await createClient()
  const { error } = await supabase.from('expenses').insert({
    entity_id: entityId,
    property_id: parsed.data.propertyId,
    category_id: parsed.data.categoryId,
    expense_date: parsed.data.expenseDate,
    description: parsed.data.description,
    amount_cents: parsed.data.amount,
    recoverable: parsed.data.recoverable,
    document_id: documentId,
  })
  if (error) return { error: friendly(error), values: submittedValues(formData, FIELDS) }
  revalidatePath(path(entityId))
  return { success: 'Dépense enregistrée.' }
}

export async function updateExpenseAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const expenseId = formText(formData, 'expenseId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(expenseId).success) return { error: 'Dépense inconnue.' }
  const parsed = expenseSchema.safeParse(fields(formData))
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: submittedValues(formData, FIELDS) }

  const changes: Record<string, unknown> = {
    property_id: parsed.data.propertyId,
    category_id: parsed.data.categoryId,
    expense_date: parsed.data.expenseDate,
    description: parsed.data.description,
    amount_cents: parsed.data.amount,
    recoverable: parsed.data.recoverable,
  }
  const file = uploaded(formData)
  if (file) {
    const result = await attachDocument(entityId, file)
    if ('error' in result) return { error: result.error }
    changes.document_id = result.id
  }

  const supabase = await createClient()
  const { data, error } = await supabase.from('expenses').update(changes).eq('id', expenseId).eq('entity_id', entityId).select('id')
  if (error) return { error: friendly(error) }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(path(entityId))
  return { success: 'Dépense modifiée.' }
}

export async function cancelExpenseAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const expenseId = formText(formData, 'expenseId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(expenseId).success) return { error: 'Dépense inconnue.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_expense', { p_expense_id: expenseId, p_reason: formText(formData, 'reason') })
  if (error) return { error: friendly(error) }
  revalidatePath(path(entityId))
  return { success: 'Dépense annulée.' }
}

export async function addCategoryAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  if (!uuid.safeParse(entityId).success) return { error: 'Structure inconnue.' }
  const name = categoryNameSchema.safeParse(formText(formData, 'name'))
  if (!name.success) return { fieldErrors: zodFieldErrors(name.error as never) }
  const supabase = await createClient()
  const { error } = await supabase.from('expense_categories').insert({ entity_id: entityId, name: name.data })
  if (error) return { error: friendly(error) }
  revalidatePath(path(entityId))
  return { success: 'Catégorie ajoutée.' }
}

export async function updateCategoryAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireUser()
  const entityId = formText(formData, 'entityId')
  const categoryId = formText(formData, 'categoryId')
  if (!uuid.safeParse(entityId).success || !uuid.safeParse(categoryId).success) return { error: 'Catégorie inconnue.' }
  const archive = formText(formData, 'archive')
  const changes: Record<string, unknown> = {}
  if (archive === '1') changes.archived_at = new Date().toISOString()
  else if (archive === '0') changes.archived_at = null
  else {
    const name = categoryNameSchema.safeParse(formText(formData, 'name'))
    if (!name.success) return { error: name.error.issues[0]?.message ?? GENERIC }
    changes.name = name.data
  }
  const supabase = await createClient()
  const { data, error } = await supabase.from('expense_categories').update(changes).eq('id', categoryId).eq('entity_id', entityId).select('id')
  if (error) return { error: friendly(error) }
  if (!data || data.length === 0) return { error: DENIED }
  revalidatePath(path(entityId))
  return { success: archive === '1' ? 'Catégorie archivée.' : archive === '0' ? 'Catégorie rétablie.' : 'Catégorie renommée.' }
}
