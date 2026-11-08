import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { STATUS_LABELS } from '@/domains/finance/labels'
import { PAYMENT_MODE_LABELS } from '@/domains/finance/schemas'
import { listCharges, listLeaseOptions, listPayments } from '@/domains/finance/service'
import { buttonVariants } from '@/components/ui/button'
import { formatDateFr, formatMonthFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { CancelChargeForm, RecalcChargeForm } from './forms'

export const metadata: Metadata = { title: 'Échéances et paiements — Loyo-reg' }

type Params = Promise<{ entityId: string }>
type Search = Promise<{ [key: string]: string | string[] | undefined }>
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function FinanceOverview({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'paiements')
  const sp = await searchParams
  const leaseId = first(sp.bail) ?? null
  const showCancelled = first(sp.annulees) === '1'

  const [charges, payments, leases] = await Promise.all([
    listCharges(entityId, { leaseId, includeCancelled: showCancelled }),
    listPayments(entityId, { leaseId, limit: 20 }),
    listLeaseOptions(entityId),
  ])
  const canWrite = permissions.includes('payment:write')
  const canChargeWrite = permissions.includes('rent_charge:write')
  const canChargeCancel = permissions.includes('rent_charge:cancel')
  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(leaseId ? { bail: leaseId } : {}), ...(showCancelled ? { annulees: '1' } : {}), ...extra })
    for (const [k, v] of [...p.entries()]) if (v === '') p.delete(k)
    const s = p.toString()
    return `/espace/${entityId}/paiements${s ? `?${s}` : ''}`
  }

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Échéances et paiements</h1>
          <p className="text-muted-foreground">{entityName}</p>
        </div>
        {canWrite && (
          <Link href={`/espace/${entityId}/paiements/nouveau${leaseId ? `?bail=${leaseId}` : ''}`} className={buttonVariants()}>
            Saisir un paiement
          </Link>
        )}
      </header>

      <nav aria-label="Filtres" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          Bail :{' '}
          <Link href={query({ bail: '' })} className={leaseId ? 'underline' : 'font-medium'}>
            Tous
          </Link>
          {leases.map((l) => (
            <span key={l.id}>
              {' · '}
              <Link href={query({ bail: l.id })} className={leaseId === l.id ? 'font-medium' : 'underline'}>
                {l.label}
              </Link>
            </span>
          ))}
        </span>
        <Link href={query({ annulees: showCancelled ? '' : '1' })} className="underline">
          {showCancelled ? 'Masquer les échéances annulées' : 'Afficher les échéances annulées'}
        </Link>
      </nav>

      <section aria-labelledby="echeances" className="grid gap-3">
        <h2 id="echeances" className="text-lg font-semibold">
          Échéances
        </h2>
        {charges.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">Aucune échéance : elles sont créées automatiquement à leur date d&apos;échéance.</p>
        ) : (
          <ul className="grid gap-3">
            {charges.map((c) => {
              const name = formatMonthFr(c.periodStart)
              const editable = c.status !== 'cancelled' && c.paidCents === 0
              return (
                <li key={c.id} className="grid gap-2 rounded-lg border p-3" data-testid="charge" data-status={c.status}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {name} · {c.leaseLabel}
                    </span>
                    <span data-testid="charge-status" className="text-sm font-medium">
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Échéance le {formatDateFr(c.dueOn)} · total {formatCents(c.totalCents)} · payé {formatCents(c.paidCents)} · reste {formatCents(c.balanceCents)}
                  </p>
                  {editable && (canChargeWrite || canChargeCancel) && (
                    <details className="text-sm">
                      <summary className="cursor-pointer">Corriger cette échéance</summary>
                      <div className="mt-3 grid gap-4">
                        {canChargeWrite && <RecalcChargeForm entityId={entityId} chargeId={c.id} name={name} />}
                        {canChargeCancel && <CancelChargeForm entityId={entityId} chargeId={c.id} name={name} />}
                      </div>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="paiements" className="grid gap-3">
        <h2 id="paiements" className="text-lg font-semibold">
          Derniers paiements
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun paiement enregistré.</p>
        ) : (
          <ul className="grid gap-2">
            {payments.map((p) => (
              <li key={p.id} className="rounded-lg border p-3 text-sm" data-testid="payment">
                <Link href={`/espace/${entityId}/paiements/${p.id}`} className="font-medium underline">
                  {formatCents(p.amountCents)} · {formatDateFr(p.receivedOn)}
                </Link>
                <span className="text-muted-foreground">
                  {' '}
                  · {PAYMENT_MODE_LABELS[p.mode as keyof typeof PAYMENT_MODE_LABELS] ?? p.mode} · {p.leaseLabel}
                  {p.cancelledAt ? ' · annulé' : p.amountCents > p.allocatedCents ? ` · ${formatCents(p.amountCents - p.allocatedCents)} non affecté` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function PaiementsPage({ params, searchParams }: PageProps<'/espace/[entityId]/paiements'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <FinanceOverview params={params} searchParams={searchParams} />
    </Suspense>
  )
}
