import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/domains/identity/session'
import { createDocumentUrl } from '@/lib/storage/private-buckets'

/**
 * Téléchargement d'un justificatif : le droit est contrôlé par la RLS de `documents` (lecture des dépenses ou des
 * apurements), puis redirection vers un lien signé de 60 secondes. Le bucket n'a aucune politique d'accès direct.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/justificatifs/[documentId]'>) {
  const { documentId } = await params
  const notFound = () => new NextResponse('Justificatif introuvable.', { status: 404 })
  if (!z.uuid().safeParse(documentId).success) return notFound()

  const user = await getCurrentUser()
  if (!user) return new NextResponse(null, { status: 303, headers: { Location: '/connexion' } })

  const supabase = await createClient()
  const { data } = await supabase.from('documents').select('file_path, original_name').eq('id', documentId).maybeSingle()
  if (!data) return notFound()
  const url = await createDocumentUrl(data.file_path, data.original_name)
  if (!url) return notFound()
  return new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } })
}
