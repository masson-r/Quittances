import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSection } from '@/domains/identity/entity-access'
import { PropertyForm } from '../forms'

export const metadata: Metadata = { title: 'Nouveau bien — Loyo-reg' }

async function NewProperty({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { permissions } = await requireSection(entityId, 'biens')
  if (!permissions.includes('property:write')) notFound()
  return (
    <div className="grid max-w-xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Nouveau bien</h1>
        <Link href={`/espace/${entityId}/biens`} className="text-sm underline">
          Retour aux biens
        </Link>
      </header>
      <PropertyForm entityId={entityId} />
    </div>
  )
}

export default function NouveauBienPage({ params }: PageProps<'/espace/[entityId]/biens/nouveau'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <NewProperty params={params} />
    </Suspense>
  )
}
