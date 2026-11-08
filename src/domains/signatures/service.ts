import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface MySignature {
  id: string
  contentType: string
  width: number
  height: number
  byteSize: number
  sha256: string
  createdAt: string
  dataUrl: string
}

/** Décode un bytea renvoyé par PostgREST (chaîne hexadécimale « \x… »). */
export const byteaToBuffer = (value: string): Buffer => Buffer.from(value.startsWith('\\x') ? value.slice(2) : value, 'hex')

/** Signature active de l'utilisateur connecté dans la structure (la RLS ne montre que la sienne). */
export async function getMySignature(entityId: string): Promise<MySignature | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('member_signatures')
    .select('id, content_type, width, height, byte_size, sha256, created_at, image')
    .eq('entity_id', entityId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  const bytes = byteaToBuffer(data.image as string)
  return {
    id: data.id,
    contentType: data.content_type,
    width: data.width,
    height: data.height,
    byteSize: data.byte_size,
    sha256: data.sha256,
    createdAt: data.created_at,
    dataUrl: `data:${data.content_type};base64,${bytes.toString('base64')}`,
  }
}
