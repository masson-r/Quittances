import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listCharges } from '@/domains/finance/service'
import { daysBetween, formatDateFr, formatMonthFr, todayInParis } from '@/lib/dates'
import { formatCents } from '@/lib/money'

export const metadata: Metadata = { title: 'Impayés — Loyo-reg' }

async function Unpaid({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { entityName } = await requireSection(entityId, 'impayes')
  const today = todayInParis()
  // Le statut « en retard » est calculé par la base : solde positif et date d'échéance dépassée (dès le lendemain).
  const late = (await listCharges(entityId, { openOnly: true })).filter((c) => c.status === 'late').sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))
  const total = late.reduce((sum, c) => sum + c.balanceCents, 0)

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Impayés</h1>
        <p className="text-muted-foreground">{entityName}</p>
      </header>

      {late.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm" data-testid="no-unpaid">
          Aucun impayé : toutes les échéances échues sont soldées.
        </p>
      ) : (
        <>
          <p className="text-sm" data-testid="unpaid-total">
            {late.length} échéance{late.length > 1 ? 's' : ''} en retard · <strong>{formatCents(total)}</strong> restent dus.
          </p>
          <ul className="grid gap-3">
            {late.map((c) => {
              const days = daysBetween(c.dueOn, today)
              return (
                <li key={c.id} className="grid gap-1 rounded-lg border p-3" data-testid="unpaid">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/espace/${entityId}/baux/${c.leaseId}`} className="font-medium underline">
                      {c.leaseLabel}
                    </Link>
                    <span className="text-sm font-medium" data-testid="days-late">
                      {days} jour{days > 1 ? 's' : ''} de retard
                    </span>
                  </div>
                  <p className="text-sm">
                    {formatMonthFr(c.periodStart)} · échue le {formatDateFr(c.dueOn)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Total {formatCents(c.totalCents)} · payé {formatCents(c.paidCents)} · <strong className="text-foreground">reste {formatCents(c.balanceCents)}</strong>
                  </p>
                  <p className="text-sm">
                    <Link href={`/espace/${entityId}/paiements?bail=${c.leaseId}`} className="underline">
                      Voir les paiements de ce bail
                    </Link>
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default function ImpayesPage({ params }: PageProps<'/espace/[entityId]/impayes'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <Unpaid params={params} />
    </Suspense>
  )
}
