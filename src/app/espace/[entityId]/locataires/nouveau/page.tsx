import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSection } from '@/domains/identity/entity-access'
import { TenantForm } from '../forms'

export const metadata: Metadata = { title: 'Nouveau dossier — Loyo-reg' }

async function NewTenant({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { permissions } = await requireSection(entityId, 'locataires')
  if (!permissions.includes('tenant:write')) notFound()
  return (
    <div className="grid max-w-xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Nouveau dossier locataire</h1>
        <Link href={`/espace/${entityId}/locataires`} className="text-sm underline">
          Retour aux locataires
        </Link>
      </header>
      <TenantForm entityId={entityId} />
    </div>
  )
}

export default function NouveauLocatairePage({ params }: PageProps<'/espace/[entityId]/locataires/nouveau'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <NewTenant params={params} />
    </Suspense>
  )
}
