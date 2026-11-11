import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/domains/identity/session'
import { createDownloadUrl } from '@/lib/storage/receipts-bucket'

/**
 * Téléchargement d'un document : le droit est contrôlé ici (propriétaire : RLS sur `receipts` ; locataire :
 * `my_receipts`, qui exclut documents annulés, rattachements révoqués et documents émis après un retrait de consentement),
 * puis l'utilisateur est redirigé vers un lien signé de 60 secondes. Le bucket n'a aucune politique d'accès direct.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/documents/[receiptId]'>) {
  const { receiptId } = await params
  const notFound = () => new NextResponse('Document introuvable.', { status: 404 })
  if (!z.uuid().safeParse(receiptId).success) return notFound()

  const user = await getCurrentUser()
  if (!user) return new NextResponse(null, { status: 303, headers: { Location: '/connexion' } })

  const supabase = await createClient()
  let path: string | null = null
  let number = receiptId

  const { data: own } = await supabase.from('receipts').select('number, file_path').eq('id', receiptId).maybeSingle()
  if (own) {
    path = own.file_path
    number = own.number
  } else {
    const { data: mine } = await supabase.rpc('my_receipts')
    const found = ((mine ?? []) as { id: string; number: string; file_path: string }[]).find((r) => r.id === receiptId)
    if (found) {
      path = found.file_path
      number = found.number
    }
  }
  if (!path) return notFound()

  const url = await createDownloadUrl(path, `${number}.pdf`)
  if (!url) return notFound()
  return new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } })
}
