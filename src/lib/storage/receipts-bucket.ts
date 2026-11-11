import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Seul module de l'application autorisé à utiliser la clé service_role (test no-service-role.test.ts) :
 * dépôt des PDF dans le bucket privé `receipts` et liens de téléchargement de 60 secondes.
 * Aucune politique Storage n'existe pour le navigateur : le bucket n'est atteignable que par ici.
 * L'appelant a déjà vérifié les droits de l'utilisateur (fonctions SQL ou RLS) avant d'appeler ce module.
 */
const BUCKET = 'receipts'
export const DOWNLOAD_LINK_SECONDS = 60

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY doivent être définies (voir .env.example).')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Chemin canonique d'un document : <structure>/<document>.pdf (celui que la base accepte à l'enregistrement). */
export const receiptPath = (entityId: string, receiptId: string): string => `${entityId}/${receiptId}.pdf`

/** Dépose le PDF. Refuse d'écraser un fichier existant : un document émis ne change jamais. */
export async function storeReceiptPdf(path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await admin().storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Dépôt du PDF impossible : ${error.message}`)
}

/** Lien de téléchargement valable 60 secondes. */
export async function createDownloadUrl(path: string, filename: string): Promise<string | null> {
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_LINK_SECONDS, { download: filename })
  if (error || !data) return null
  return data.signedUrl
}

/** Contenu d'un fichier déjà déposé (contrôle d'intégrité). */
export async function readReceiptPdf(path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin().storage.from(BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}
