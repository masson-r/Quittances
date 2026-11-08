import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSection } from '@/domains/identity/entity-access'
import { listCharges, listLeaseOptions } from '@/domains/finance/service'
import { PaymentForm } from '../forms'

export const metadata: Metadata = { title: 'Saisir un paiement — Loyo-reg' }

async function NewPayment({ params, searchParams }: { params: Promise<{ entityId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { entityId } = await params
  const { permissions } = await requireSection(entityId, 'paiements')
  if (!permissions.includes('payment:write')) notFound()
  const bail = (await searchParams).bail
  const [leases, open] = await Promise.all([listLeaseOptions(entityId), listCharges(entityId, { openOnly: true })])
  const initial = typeof bail === 'string' && leases.some((l) => l.id === bail) ? bail : ''

  return (
    <div className="grid max-w-xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Saisir un paiement</h1>
        <Link href={`/espace/${entityId}/paiements`} className="text-sm underline">
          Retour aux échéances et paiements
        </Link>
      </header>
      <PaymentForm
        entityId={entityId}
        leases={leases}
        initialLeaseId={initial}
        charges={open.map((c) => ({ id: c.id, leaseId: c.leaseId, periodStart: c.periodStart, dueOn: c.dueOn, balanceCents: c.balanceCents }))}
      />
    </div>
  )
}

export default function NouveauPaiementPage({ params, searchParams }: PageProps<'/espace/[entityId]/paiements/nouveau'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <NewPayment params={params} searchParams={searchParams} />
    </Suspense>
  )
}
