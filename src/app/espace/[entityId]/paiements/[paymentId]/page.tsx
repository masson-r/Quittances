import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireSection } from '@/domains/identity/entity-access'
import { PAYMENT_MODE_LABELS } from '@/domains/finance/schemas'
import { getPayment, listCharges } from '@/domains/finance/service'
import { formatDateFr, formatMonthFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { AllocateRemainingForm, CancelPaymentForm, MoveAllocationForm, ReverseAllocationForm, UpdatePaymentForm } from '../forms'

export const metadata: Metadata = { title: 'Paiement — Loyo-reg' }

async function PaymentSheet({ params }: { params: Promise<{ entityId: string; paymentId: string }> }) {
  const { entityId, paymentId } = await params
  if (!z.uuid().safeParse(paymentId).success) notFound()
  const { permissions } = await requireSection(entityId, 'paiements')
  const found = await getPayment(entityId, paymentId)
  if (!found) notFound()
  const { payment, allocations } = found

  const canWrite = permissions.includes('payment:write')
  const canCancel = permissions.includes('payment:cancel')
  const cancelled = payment.cancelledAt !== null
  const active = allocations.filter((a) => a.reversedAt === null)
  const remaining = payment.amountCents - payment.allocatedCents
  const open = canWrite && !cancelled ? await listCharges(entityId, { leaseId: payment.leaseId, openOnly: true }) : []
  const modeLabel = PAYMENT_MODE_LABELS[payment.mode as keyof typeof PAYMENT_MODE_LABELS] ?? payment.mode

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">
          Paiement de {formatCents(payment.amountCents)}
          {cancelled && <span className="text-muted-foreground ml-2 text-base font-normal">(annulé)</span>}
        </h1>
        <p className="text-muted-foreground">
          Reçu le {formatDateFr(payment.receivedOn)} · {modeLabel} · {payment.leaseLabel}
        </p>
        {cancelled && <p className="text-sm">Motif de l&apos;annulation : {payment.cancellationReason}</p>}
        <Link href={`/espace/${entityId}/paiements`} className="text-sm underline">
          Retour aux échéances et paiements
        </Link>
      </header>

      <section aria-labelledby="affectations" className="grid max-w-xl gap-3">
        <h2 id="affectations" className="text-lg font-semibold">
          Affectations
        </h2>
        {allocations.length === 0 ? (
          <p className="text-muted-foreground text-sm">Ce paiement n&apos;est affecté à aucune échéance.</p>
        ) : (
          <ul className="grid gap-3">
            {allocations.map((a) => {
              const name = formatMonthFr(a.periodStart)
              return (
                <li key={a.id} className="grid gap-3 rounded-lg border p-3" data-testid="allocation" data-reversed={a.reversedAt ? 'true' : 'false'}>
                  <p className="text-sm">
                    {formatCents(a.amountCents)} sur l&apos;échéance de <strong>{name}</strong>
                    {a.reversedAt && <span className="text-muted-foreground"> — retirée ({a.reversalReason})</span>}
                  </p>
                  {canWrite && !cancelled && !a.reversedAt && (
                    <details className="text-sm">
                      <summary className="cursor-pointer">Corriger cette affectation</summary>
                      <div className="mt-3 grid gap-4">
                        <ReverseAllocationForm entityId={entityId} paymentId={paymentId} allocationId={a.id} name={name} />
                        <MoveAllocationForm
                          entityId={entityId}
                          paymentId={paymentId}
                          allocationId={a.id}
                          name={name}
                          targets={open.filter((c) => c.id !== a.rentChargeId).map((c) => ({ id: c.id, label: `${formatMonthFr(c.periodStart)} · reste ${formatCents(c.balanceCents)}` }))}
                        />
                      </div>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {!cancelled && remaining > 0 && (
          <p className="text-sm" data-testid="remaining">
            {formatCents(remaining)} restent non affectés.
          </p>
        )}
        {canWrite && !cancelled && remaining > 0 && open.length > 0 && <AllocateRemainingForm entityId={entityId} paymentId={paymentId} remainingCents={remaining} charges={open.map((c) => ({ id: c.id, leaseId: c.leaseId, periodStart: c.periodStart, dueOn: c.dueOn, balanceCents: c.balanceCents }))} />}
        {active.length === 0 && allocations.length > 0 && !cancelled && <p className="text-muted-foreground text-sm">Toutes les affectations ont été retirées.</p>}
      </section>

      {canWrite && !cancelled && (
        <section aria-labelledby="corrections" className="grid max-w-xl gap-3">
          <h2 id="corrections" className="text-lg font-semibold">
            Corriger le paiement
          </h2>
          <p className="text-muted-foreground text-sm">Le montant ne se corrige pas : annulez ce paiement puis saisissez-le à nouveau.</p>
          <UpdatePaymentForm entityId={entityId} paymentId={paymentId} reference={payment.reference} comment={payment.comment} mode={payment.mode} receivedOn={payment.receivedOn} />
        </section>
      )}

      {canCancel && !cancelled && (
        <section aria-labelledby="annulation" className="grid max-w-xl gap-3">
          <h2 id="annulation" className="text-lg font-semibold">
            Annulation
          </h2>
          <p className="text-muted-foreground text-sm">Les affectations sont retirées et les soldes des échéances restaurés. Le paiement et son motif sont conservés.</p>
          <CancelPaymentForm entityId={entityId} paymentId={paymentId} />
        </section>
      )}
    </div>
  )
}

export default function PaiementPage({ params }: PageProps<'/espace/[entityId]/paiements/[paymentId]'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <PaymentSheet params={params} />
    </Suspense>
  )
}
