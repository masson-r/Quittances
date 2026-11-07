import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isInvitationToken } from '@/domains/identity/roles'
import { requireUser } from '@/domains/identity/session'
import { AcceptInvitationForm } from './form'

export const metadata: Metadata = { title: 'Invitation — Loyo-reg', robots: { index: false } }

async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Connexion obligatoire ; le second facteur n'est pas encore exigé (il l'est après l'adhésion, selon le rôle).
  const user = await requireUser({ allowMfaPending: true })
  if (!isInvitationToken(token)) return <p role="alert">Lien invalide ou expiré.</p>
  return <AcceptInvitationForm token={token} email={user.email} />
}

export default function InvitationPage({ params }: PageProps<'/invitation/[token]'>) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Invitation</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Invitation params={params} />
      </Suspense>
    </>
  )
}
