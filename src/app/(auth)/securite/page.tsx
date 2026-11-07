import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@/domains/identity/session'
import { RegenerateCodes } from './forms'

export const metadata: Metadata = { title: 'Sécurité — Loyo-reg' }

async function Security() {
  await requireUser()
  return <RegenerateCodes />
}

export default function SecuritePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Sécurité du compte</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Security />
      </Suspense>
      <p className="text-sm">
        <Link href="/espace" className="underline">
          Retour à mon espace
        </Link>
      </p>
    </>
  )
}
