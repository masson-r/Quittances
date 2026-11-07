import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireUser } from '@/domains/identity/session'
import { VerifyForm } from '../forms'

export const metadata: Metadata = { title: 'Second facteur — Loyo-reg' }

async function Verify() {
  await requireUser({ allowMfaPending: true })
  return <VerifyForm />
}

export default function VerificationPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Second facteur</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Verify />
      </Suspense>
    </>
  )
}
