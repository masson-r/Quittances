import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSection } from '@/domains/identity/entity-access'
import { listProperties } from '@/domains/properties/service'
import { listTenants, tenantName } from '@/domains/tenants/service'
import { NewLeaseForm } from '../forms'

export const metadata: Metadata = { title: 'Nouveau bail — Loyo-reg' }

async function NewLease({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { permissions } = await requireSection(entityId, 'baux')
  if (!permissions.includes('lease:write')) notFound()
  const [properties, tenants] = await Promise.all([listProperties(entityId, false), listTenants(entityId, false)])

  return (
    <div className="grid max-w-xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Nouveau bail</h1>
        <Link href={`/espace/${entityId}/baux`} className="text-sm underline">
          Retour aux baux
        </Link>
      </header>
      <NewLeaseForm
        entityId={entityId}
        properties={properties.map((p) => ({ id: p.id, label: p.label }))}
        tenants={tenants.map((t) => ({ id: t.id, label: tenantName(t) }))}
      />
    </div>
  )
}

export default function NouveauBailPage({ params }: PageProps<'/espace/[entityId]/baux/nouveau'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <NewLease params={params} />
    </Suspense>
  )
}
