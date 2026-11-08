import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listLeases } from '@/domains/leasing/service'
import { LEASE_STATUS_LABELS } from '@/domains/leasing/status'
import { formatDateFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { buttonVariants } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Baux — Loyo-reg' }

async function LeasesList({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'baux')
  const leases = await listLeases(entityId)

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Baux</h1>
          <p className="text-muted-foreground">{entityName}</p>
        </div>
        {permissions.includes('lease:write') && (
          <Link href={`/espace/${entityId}/baux/nouveau`} className={buttonVariants()}>
            Nouveau bail
          </Link>
        )}
      </header>

      {leases.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">Aucun bail pour le moment.</p>
      ) : (
        <ul className="grid gap-3">
          {leases.map((l) => (
            <li key={l.id} className="grid gap-1 rounded-lg border p-3" data-testid="lease">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/espace/${entityId}/baux/${l.id}`} className="font-medium underline">
                  {l.propertyLabel}
                </Link>
                <span className="text-muted-foreground text-sm">{LEASE_STATUS_LABELS[l.status]}</span>
              </div>
              <p className="text-sm">{l.presentTenants.length > 0 ? l.presentTenants.join(', ') : 'Aucun locataire présent'}</p>
              <p className="text-muted-foreground text-sm">
                Du {formatDateFr(l.startDate)} {l.endDate ? `au ${formatDateFr(l.endDate)}` : '(sans date de fin)'} · {formatCents(l.rentCents)} + {formatCents(l.chargesCents)} de charges
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BauxPage({ params }: PageProps<'/espace/[entityId]/baux'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <LeasesList params={params} />
    </Suspense>
  )
}
