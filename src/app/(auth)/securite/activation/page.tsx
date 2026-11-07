import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireUser } from '@/domains/identity/session'
import { EnrollForm } from '../forms'

export const metadata: Metadata = { title: 'Activer le second facteur — Loyo-reg' }

async function Enroll({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireUser({ allowMfaPending: true })
  const params = await searchParams
  return <EnrollForm afterRecovery={params.secours === '1'} />
}

export default function ActivationPage({ searchParams }: PageProps<'/securite/activation'>) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Activer le second facteur</h1>
      <p className="text-muted-foreground text-sm">
        Pour protéger les données de vos locataires, l&apos;administrateur et le gestionnaire doivent confirmer leur connexion avec une application d&apos;authentification.
      </p>
      <Suspense fallback={<p>Chargement…</p>}>
        <Enroll searchParams={searchParams} />
      </Suspense>
    </>
  )
}
