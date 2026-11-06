import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireUser } from '@/domains/identity/session'

export const metadata: Metadata = { title: 'Mon espace — Loyo-reg' }

async function Welcome() {
  const user = await requireUser()
  return <h1 className="text-2xl font-semibold">Bonjour {user.firstName}</h1>
}

export default function EspacePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<p>Chargement…</p>}>
        <Welcome />
      </Suspense>
    </main>
  )
}
