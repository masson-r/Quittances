import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { listMyMemberships } from '@/domains/identity/members-service'
import { roleLabel } from '@/domains/identity/roles'
import { requireUser } from '@/domains/identity/session'

export const metadata: Metadata = { title: 'Mon espace — Loyo-reg' }

async function Welcome() {
  const user = await requireUser()
  const memberships = await listMyMemberships(user.id)
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Bonjour {user.firstName}</h1>
      <section aria-labelledby="structures-titre" className="grid gap-3">
        <h2 id="structures-titre" className="text-lg font-semibold">
          Mes structures
        </h2>
        {memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">Vous n&apos;êtes membre d&apos;aucune structure. Utilisez le lien d&apos;invitation que vous avez reçu.</p>
        ) : (
          <ul className="grid gap-2">
            {memberships.map((m) => (
              <li key={m.entityId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3" data-testid="my-structure">
                <Link href={`/espace/${m.entityId}/tableau-de-bord`} className="font-medium underline">
                  {m.entityName}
                </Link>
                <span className="text-muted-foreground text-sm">{roleLabel(m.role)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function EspacePage() {
  return (
    <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<p>Chargement…</p>}>
        <Welcome />
      </Suspense>
    </main>
  )
}
