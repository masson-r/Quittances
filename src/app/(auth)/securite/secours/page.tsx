import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireUser } from '@/domains/identity/session'
import { RecoveryForm } from '../forms'

export const metadata: Metadata = { title: 'Code de secours — Loyo-reg' }

async function Recovery() {
  await requireUser({ allowMfaPending: true })
  return <RecoveryForm />
}

export default function SecoursPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Code de secours</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Recovery />
      </Suspense>
    </>
  )
}
