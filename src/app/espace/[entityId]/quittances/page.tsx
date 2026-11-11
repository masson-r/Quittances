import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { KIND_LABELS, listIssuable, listReceipts } from '@/domains/receipts/service'
import { formatMonthFr, formatDateFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { CancelForm, FinalizeForm, IssueForm, ReplaceForm } from './forms'

export const metadata: Metadata = { title: 'Quittances — Loyo-reg' }

async function Receipts({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'quittances')
  const canIssue = permissions.includes('receipt:write')
  const canCancel = permissions.includes('receipt:cancel')
  const [receipts, issuable] = await Promise.all([listReceipts(entityId), canIssue ? listIssuable(entityId) : Promise.resolve([])])

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Quittances</h1>
          <p className="text-muted-foreground">{entityName}</p>
        </div>
        {permissions.includes('signature:write') && (
          <Link href={`/espace/${entityId}/ma-signature`} className="text-sm underline">
            Ma signature
          </Link>
        )}
      </header>

      {canIssue && (
        <section aria-labelledby="a-emettre" className="grid gap-3">
          <h2 id="a-emettre" className="text-lg font-semibold">
            À émettre
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            Une quittance n&apos;est possible que pour une échéance intégralement réglée. Pour un paiement partiel, un reçu est délivré : il ne vaut pas quittance.
            Le PDF est généré une seule fois, à l&apos;émission.
          </p>
          {issuable.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm" data-testid="nothing-to-issue">
              Rien à émettre pour le moment.
            </p>
          ) : (
            <ul className="grid gap-3">
              {issuable.map((i) => {
                const label = `${KIND_LABELS[i.kind]} ${i.label} ${formatMonthFr(i.periodStart)}`
                return (
                  <li key={`${i.rentChargeId}${i.paymentId ?? ''}`} className="grid gap-3 rounded-lg border p-3" data-testid="issuable">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {KIND_LABELS[i.kind]} · {i.label} · {formatMonthFr(i.periodStart)}
                      </span>
                      <span className="text-sm">{formatCents(i.amountCents)}</span>
                    </div>
                    <IssueForm entityId={entityId} kind={i.kind} rentChargeId={i.rentChargeId} paymentId={i.paymentId} defaultPaidOn={i.defaultPaidOn} label={label} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="emis" className="grid gap-3">
        <h2 id="emis" className="text-lg font-semibold">
          Documents émis
        </h2>
        {receipts.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">Aucun document émis.</p>
        ) : (
          <ul className="grid gap-3">
            {receipts.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-lg border p-3" data-testid="receipt">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium" data-testid="receipt-number">
                    {r.number}
                  </span>
                  <span className="text-sm" data-testid="receipt-state">
                    {r.cancelledAt ? 'Annulé' : r.hasFile ? 'Disponible' : 'À finaliser'}
                  </span>
                </div>
                <p className="text-sm">
                  {KIND_LABELS[r.kind]} · {r.propertyLabel} · {formatMonthFr(r.periodStart)} · {formatCents(r.amountCents)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {r.tenants.join(', ')} · émis le {formatDateFr(r.issuedOn)}
                  {r.version > 1 ? ` · version ${r.version}` : ''}
                </p>
                {r.cancelledAt && <p className="text-sm">Motif d&apos;annulation : {r.cancellationReason}</p>}
                {r.hasFile && (
                  <a href={`/documents/${r.id}`} className="w-fit text-sm underline" aria-label={`Télécharger le PDF ${r.number}`}>
                    Télécharger le PDF
                  </a>
                )}
                {!r.cancelledAt && !r.hasFile && canIssue && <FinalizeForm entityId={entityId} receiptId={r.id} number={r.number} />}
                {!r.cancelledAt && canCancel && (
                  <details className="text-sm">
                    <summary className="w-fit cursor-pointer underline">Annuler ou remplacer</summary>
                    <div className="mt-3 grid gap-5">
                      <CancelForm entityId={entityId} receiptId={r.id} number={r.number} />
                      {canIssue && <ReplaceForm entityId={entityId} receiptId={r.id} number={r.number} paidOn="" />}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function Page({ params }: PageProps<'/espace/[entityId]/quittances'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <Receipts params={params} />
    </Suspense>
  )
}
