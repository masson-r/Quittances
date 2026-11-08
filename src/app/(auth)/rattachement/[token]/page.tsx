import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isInvitationToken } from '@/domains/identity/roles'
import { requireUser } from '@/domains/identity/session'
import { RequestAccessForm } from '@/components/tenant-access/forms'

export const metadata: Metadata = { title: 'Accès locataire — Loyo-reg', robots: { index: false } }

async function Attachment({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await requireUser({ allowMfaPending: true })
  if (!isInvitationToken(token)) return <p role="alert">Lien invalide ou expiré.</p>
  return (
    <>
      <p className="text-sm">
        Vous êtes connecté avec <strong>{user.email}</strong>. Votre demande sera transmise au propriétaire, qui la validera : tant qu&apos;elle n&apos;est pas
        validée, vous ne voyez aucun document.
      </p>
      <RequestAccessForm token={token} />
    </>
  )
}

export default function RattachementPage({ params }: PageProps<'/rattachement/[token]'>) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Accéder à mes quittances</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Attachment params={params} />
      </Suspense>
    </>
  )
}
