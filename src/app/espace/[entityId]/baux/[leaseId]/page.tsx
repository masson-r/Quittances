import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireSection } from '@/domains/identity/entity-access'
import { getLease } from '@/domains/leasing/service'
import { LEASE_STATUS_LABELS } from '@/domains/leasing/status'
import { PAYMENT_MODE_LABELS } from '@/domains/finance/schemas'
import { SETTLEMENT_KIND_LABELS } from '@/domains/settlements/schemas'
import { finalSettlementMissing, listRefundablePayments, listSettlements } from '@/domains/settlements/service'
import { listTenants, tenantName } from '@/domains/tenants/service'
import { formatDateFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { CoTenantForm, EndLeaseForm, EndPresenceForm, TermForm } from '../forms'
import { CancelSettlementForm, SettlementForm, UpdateSettlementForm } from '../settlement-forms'

export const metadata: Metadata = { title: 'Bail — Loyo-reg' }

async function LeaseSheet({ params }: { params: Promise<{ entityId: string; leaseId: string }> }) {
  const { entityId, leaseId } = await params
  if (!z.uuid().safeParse(leaseId).success) notFound()
  const { permissions } = await requireSection(entityId, 'baux')
  const lease = await getLease(entityId, leaseId)
  if (!lease) notFound()

  const canWrite = permissions.includes('lease:write')
  const tenants = canWrite ? await listTenants(entityId, false) : []
  const canSeeSettlements = permissions.includes('settlement:read')
  const canWriteSettlements = permissions.includes('settlement:write')
  const canCancelSettlements = permissions.includes('settlement:cancel')
  const [settlements, finalMissing, refundable] = canSeeSettlements
    ? await Promise.all([listSettlements(leaseId), finalSettlementMissing(leaseId), canWriteSettlements ? listRefundablePayments(leaseId) : Promise.resolve([])])
    : [[], false, []]

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Bail — {lease.propertyLabel}</h1>
        <p className="text-muted-foreground">
          {LEASE_STATUS_LABELS[lease.status]} · du {formatDateFr(lease.startDate)} {lease.endDate ? `au ${formatDateFr(lease.endDate)}` : '(sans date de fin)'}
        </p>
        <p className="flex flex-wrap gap-x-4 text-sm">
          <Link href={`/espace/${entityId}/baux`} className="underline">
            Retour aux baux
          </Link>
          <Link href={`/espace/${entityId}/biens/${lease.propertyId}`} className="underline">
            Voir le bien
          </Link>
        </p>
      </header>

      <section aria-labelledby="resume" className="grid max-w-xl gap-2">
        <h2 id="resume" className="text-lg font-semibold">
          Résumé
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Loyer actuel</dt>
          <dd>{formatCents(lease.rentCents)}</dd>
          <dt className="text-muted-foreground">Provisions pour charges</dt>
          <dd>{formatCents(lease.chargesCents)}</dd>
          <dt className="text-muted-foreground">Jour d&apos;échéance</dt>
          <dd>{lease.dueDay}</dd>
          <dt className="text-muted-foreground">Dépôt de garantie</dt>
          <dd>
            {lease.depositCents === null ? 'Non renseigné' : formatCents(lease.depositCents)}
            {lease.depositReceivedOn && ` (reçu le ${formatDateFr(lease.depositReceivedOn)})`}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="locataires" className="grid max-w-xl gap-3">
        <h2 id="locataires" className="text-lg font-semibold">
          Locataires et périodes de présence
        </h2>
        <ul className="grid gap-3">
          {lease.presences.map((p) => (
            <li key={p.id} className="grid gap-2 rounded-lg border p-3" data-testid="presence">
              <p className="text-sm">
                <span className="font-medium">{p.tenantName}</span> · depuis le {formatDateFr(p.startDate)} {p.endDate ? `jusqu'au ${formatDateFr(p.endDate)}` : '(présent)'}
              </p>
              {canWrite && p.endDate === null && <EndPresenceForm entityId={entityId} leaseId={leaseId} presenceId={p.id} name={p.tenantName} />}
            </li>
          ))}
        </ul>
        {canWrite && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Ajouter un colocataire</summary>
            <div className="mt-3">
              <CoTenantForm entityId={entityId} leaseId={leaseId} tenants={tenants.map((t) => ({ id: t.id, label: tenantName(t) }))} />
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="conditions" className="grid max-w-xl gap-3">
        <h2 id="conditions" className="text-lg font-semibold">
          Conditions de loyer
        </h2>
        <ul className="grid gap-2">
          {lease.terms.map((t) => (
            <li key={t.id} className="rounded-lg border p-3 text-sm" data-testid="term">
              À partir du {formatDateFr(t.effectiveFrom)} : <strong>{formatCents(t.rentCents)}</strong> + {formatCents(t.chargesCents)} de charges
              {t.reason && <span className="text-muted-foreground"> — {t.reason}</span>}
            </li>
          ))}
        </ul>
        {canWrite && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Modifier le loyer ou les charges</summary>
            <div className="mt-3">
              <TermForm entityId={entityId} leaseId={leaseId} />
            </div>
          </details>
        )}
      </section>

      {canSeeSettlements && (
        <section aria-labelledby="apurement" className="grid max-w-xl gap-3">
          <h2 id="apurement" className="text-lg font-semibold">
            Apurement des charges
          </h2>
          {finalMissing && (
            <p role="status" className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950" data-testid="final-missing">
              Apurement final à saisir : le bail est terminé et aucun apurement final n&apos;a été enregistré (il peut être nul).
            </p>
          )}
          {settlements.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun apurement enregistré.</p>
          ) : (
            <ul className="grid gap-3">
              {settlements.map((st) => (
                <li key={st.id} className="grid gap-2 rounded-lg border p-3" data-testid="settlement" data-cancelled={st.cancelledAt ? 'true' : 'false'}>
                  <p className="text-sm">
                    <strong>{st.amountCents < 0 ? `Complément reçu : ${formatCents(-st.amountCents)}` : st.amountCents === 0 ? 'Apurement nul' : `Remboursé : ${formatCents(st.amountCents)}`}</strong>
                    {st.isFinal && <span> · apurement final</span>}
                    {st.cancelledAt && <span className="text-muted-foreground"> · annulé ({st.cancellationReason})</span>}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {formatDateFr(st.settledOn)} · {PAYMENT_MODE_LABELS[st.mode as keyof typeof PAYMENT_MODE_LABELS] ?? st.mode} · {SETTLEMENT_KIND_LABELS[st.kind]} · {st.reason}
                    {st.periodStart && st.periodEnd && ` · période du ${formatDateFr(st.periodStart)} au ${formatDateFr(st.periodEnd)}`}
                  </p>
                  {!st.cancelledAt && (canWriteSettlements || canCancelSettlements) && (
                    <details className="text-sm">
                      <summary className="cursor-pointer">Corriger cet apurement</summary>
                      <div className="mt-3 grid gap-4">
                        {canWriteSettlements && <UpdateSettlementForm entityId={entityId} leaseId={leaseId} row={st} />}
                        {canCancelSettlements && <CancelSettlementForm entityId={entityId} leaseId={leaseId} settlementId={st.id} />}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWriteSettlements && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Saisir un apurement</summary>
              <div className="mt-3">
                <SettlementForm entityId={entityId} leaseId={leaseId} payments={refundable} />
              </div>
            </details>
          )}
        </section>
      )}

      {canWrite && lease.endDate === null && (
        <section aria-labelledby="fin" className="grid max-w-xl gap-3">
          <h2 id="fin" className="text-lg font-semibold">
            Fin du bail
          </h2>
          <EndLeaseForm entityId={entityId} leaseId={leaseId} />
        </section>
      )}
    </div>
  )
}

export default function BailPage({ params }: PageProps<'/espace/[entityId]/baux/[leaseId]'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <LeaseSheet params={params} />
    </Suspense>
  )
}
