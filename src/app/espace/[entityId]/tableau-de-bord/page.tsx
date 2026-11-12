import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listMyMemberships } from '@/domains/identity/members-service'
import {
  countPendingAccess,
  getByProperty,
  getMonthly,
  getRecentOperations,
  getSummary,
  listAllProperties,
  type DashboardScope,
} from '@/domains/dashboard/service'
import { PERIODS, PERIOD_LABELS, collectionRate, monthlyRange, resolvePeriod } from '@/domains/dashboard/period'
import { formatDateFr, formatMonthFr, todayInParis } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { MonthlyChart } from './monthly-chart'

export const metadata: Metadata = { title: 'Tableau de bord — Loyo-reg' }

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : [])
const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Kpi({ label, value, hint, testId, tone }: { label: string; value: string; hint?: string; testId: string; tone?: 'alert' }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-3" data-testid={testId}>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className={`text-xl font-semibold ${tone === 'alert' ? 'text-destructive' : ''}`}>{value}</dd>
      {hint && <dd className="text-muted-foreground text-xs">{hint}</dd>}
    </div>
  )
}

async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { entityId } = await params
  const query = await searchParams
  const { user, permissions } = await requireSection(entityId, 'tableau-de-bord')
  const memberships = await listMyMemberships(user.id)
  const myEntityIds = memberships.map((m) => m.entityId)

  // Filtres dans l'URL. Par défaut : toutes mes structures, tous les biens, mois en cours.
  const structure = first(query.structure)
  const selectedEntity = structure && uuidLike.test(structure) && myEntityIds.includes(structure) ? structure : null
  const entityIds = selectedEntity ? [selectedEntity] : null
  const properties = (await listAllProperties()).filter((p) => (selectedEntity ? p.entityId === selectedEntity : true))
  const propertyIds = all(query.bien).filter((id) => uuidLike.test(id) && properties.some((p) => p.id === id))
  const today = todayInParis()
  const period = resolvePeriod(first(query.periode), today, { from: first(query.du), to: first(query.au) })
  const scope: DashboardScope = { entityIds, propertyIds: propertyIds.length > 0 ? propertyIds : null, from: period.from, to: period.to }
  const range = monthlyRange(period)

  const [summary, monthly, byProperty, recent, pending] = await Promise.all([
    getSummary(scope),
    getMonthly({ ...scope, from: range.from, to: range.to }),
    getByProperty(scope),
    getRecentOperations(entityIds),
    permissions.includes('tenant:write') ? countPendingAccess(entityIds) : Promise.resolve(0),
  ])

  const multiEntity = new Set(byProperty.map((p) => p.entityId)).size > 1
  const scopeLabel = selectedEntity ? (memberships.find((m) => m.entityId === selectedEntity)?.entityName ?? '') : 'Toutes mes structures'

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <p className="text-muted-foreground">
          {scopeLabel} · du {formatDateFr(period.from)} au {formatDateFr(period.to)}
        </p>
      </header>

      <form method="get" className="grid gap-3 rounded-lg border p-3" aria-label="Filtres du tableau de bord">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Structure
            <select name="structure" defaultValue={selectedEntity ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="">Toutes mes structures</option>
              {memberships.map((m) => (
                <option key={m.entityId} value={m.entityId}>
                  {m.entityName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Période
            <select name="periode" defaultValue={period.key} className="border-input bg-background h-9 rounded-md border px-2">
              {PERIODS.map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Du (dates personnalisées)
            <input type="date" name="du" defaultValue={period.key === 'perso' ? period.from : ''} className="border-input bg-background h-9 rounded-md border px-2" />
          </label>
          <label className="grid gap-1 text-sm">
            Au
            <input type="date" name="au" defaultValue={period.key === 'perso' ? period.to : ''} className="border-input bg-background h-9 rounded-md border px-2" />
          </label>
          <button type="submit" className="border-input bg-background h-9 rounded-md border px-3 text-sm">
            Appliquer
          </button>
        </div>
        {properties.length > 0 && (
          <fieldset className="grid gap-1">
            <legend className="text-sm">Biens (tous si aucun n&apos;est coché)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {properties.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="bien" value={p.id} defaultChecked={propertyIds.includes(p.id)} className="size-4" />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </form>

      {pending > 0 && (
        <p className="rounded-lg border p-3 text-sm" data-testid="pending-access">
          {pending} demande(s) de rattachement de locataire en attente.{' '}
          <Link href={`/espace/${entityId}/locataires`} className="underline">
            Les traiter
          </Link>
        </p>
      )}
      {summary && summary.finalSettlementsPending > 0 && (
        <p className="rounded-lg border p-3 text-sm" data-testid="final-settlements">
          {summary.finalSettlementsPending} apurement(s) final(aux) à saisir pour des baux terminés.{' '}
          <Link href={`/espace/${entityId}/baux`} className="underline">
            Voir les baux
          </Link>
        </p>
      )}

      {summary ? (
        <section aria-labelledby="bandeau" className="grid gap-3">
          <h2 id="bandeau" className="sr-only">
            Indicateurs
          </h2>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi testId="kpi-properties" label="Biens actifs" value={String(summary.activeProperties)} />
            <Kpi testId="kpi-leases" label="Baux en cours" value={String(summary.runningLeases)} />
            <Kpi testId="kpi-tenants" label="Locataires actifs" value={String(summary.activeTenants)} />
            <Kpi testId="kpi-called" label="Loyers appelés" value={formatCents(summary.calledCents)} hint="Échéances de la période" />
            <Kpi testId="kpi-collected" label="Encaissé" value={formatCents(summary.collectedCents)} hint="Paiements reçus dans la période" />
            <Kpi testId="kpi-remaining" label="Restant dû" value={formatCents(summary.remainingDueCents)} hint="À ce jour, échéances échues" />
            <Kpi
              testId="kpi-overdue"
              label="Impayés échus"
              value={formatCents(summary.overdueCents)}
              hint={summary.overdueCount > 0 ? `${summary.overdueCount} échéance(s), jusqu'à ${summary.overdueMaxDays} jour(s) de retard` : 'Aucun'}
              tone={summary.overdueCents > 0 ? 'alert' : undefined}
            />
            <Kpi testId="kpi-expenses" label="Dépenses" value={formatCents(summary.expensesCents)} />
            <Kpi testId="kpi-balance" label="Solde de trésorerie estimé" value={formatCents(summary.estimatedBalanceCents)} hint="Encaissé − dépenses − remboursements de charges" />
            <Kpi testId="kpi-to-allocate" label="À affecter" value={formatCents(summary.toAllocateCents)} hint="Paiements non affectés à une échéance" />
          </dl>
          <p className="text-muted-foreground text-sm">
            Le solde de trésorerie estimé n&apos;est pas un résultat fiscal. Remboursements de charges nets sur la période : {formatCents(summary.refundsNetCents)}.
          </p>
          {summary.overdueCount > 0 && (
            <Link href={`/espace/${entityId}/impayes`} className="w-fit text-sm underline">
              Voir les impayés
            </Link>
          )}
        </section>
      ) : (
        <p role="alert">Les indicateurs n&apos;ont pas pu être calculés. Réessayez dans quelques instants.</p>
      )}

      <section aria-labelledby="evolution" className="grid gap-3">
        <h2 id="evolution" className="text-lg font-semibold">
          Évolution mensuelle
        </h2>
        <MonthlyChart
          rows={monthly.map((m) => ({ label: formatMonthFr(m.month), calledCents: m.calledCents, collectedCents: m.collectedCents, expensesCents: m.expensesCents }))}
        />
      </section>

      <section aria-labelledby="biens" className="grid gap-3">
        <h2 id="biens" className="text-lg font-semibold">
          Comparaison par bien
        </h2>
        {byProperty.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">Aucun bien pour cette sélection.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Comparaison par bien (défilement horizontal)">
            <table className="w-full min-w-[44rem] text-sm" data-testid="by-property">
              <caption className="sr-only">Indicateurs de la période, bien par bien</caption>
              <thead>
                <tr className="border-b text-left">
                  {multiEntity && <th scope="col" className="py-2 pr-3 font-medium">Structure</th>}
                  <th scope="col" className="py-2 pr-3 font-medium">Bien</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Appelé</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Encaissé</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Impayé</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Dépenses</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Remboursements</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Solde</th>
                  <th scope="col" className="py-2 text-right font-medium">Taux d&apos;encaissement</th>
                </tr>
              </thead>
              <tbody>
                {byProperty.map((p) => {
                  const rate = collectionRate(p.collectedCents, p.calledCents)
                  return (
                    <tr key={p.propertyId} className="border-b" data-testid="property-row">
                      {multiEntity && <td className="py-2 pr-3">{p.entityName}</td>}
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {p.propertyLabel}
                      </th>
                      <td className="py-2 pr-3 text-right">{formatCents(p.calledCents)}</td>
                      <td className="py-2 pr-3 text-right">{formatCents(p.collectedCents)}</td>
                      <td className="py-2 pr-3 text-right">{formatCents(p.overdueCents)}</td>
                      <td className="py-2 pr-3 text-right">{formatCents(p.expensesCents)}</td>
                      <td className="py-2 pr-3 text-right">{formatCents(p.refundsNetCents)}</td>
                      <td className="py-2 pr-3 text-right">{formatCents(p.estimatedBalanceCents)}</td>
                      <td className="py-2 text-right">{rate === null ? '—' : `${rate} %`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="operations" className="grid gap-3">
        <h2 id="operations" className="text-lg font-semibold">
          Dernières opérations
        </h2>
        {recent.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">Aucune opération enregistrée.</p>
        ) : (
          <ul className="grid gap-2">
            {recent.map((o, i) => (
              <li key={`${o.kind}${o.at}${i}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3 text-sm" data-testid="recent-operation">
                <span>
                  <span className="font-medium">{o.label}</span>
                  {o.detail && <span className="text-muted-foreground"> · {o.detail}</span>}
                  <span className="text-muted-foreground"> · {formatDateFr(o.date)}</span>
                </span>
                <span>{formatCents(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function Page({ params, searchParams }: PageProps<'/espace/[entityId]/tableau-de-bord'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <Dashboard params={params} searchParams={searchParams} />
    </Suspense>
  )
}
