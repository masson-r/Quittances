'use client'

import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, SelectField, TextField } from '@/components/forms/fields'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  allocateRemainingAction,
  cancelChargeAction,
  cancelPaymentAction,
  moveAllocationAction,
  recalcChargeAction,
  recordPaymentAction,
  reverseAllocationAction,
  updatePaymentAction,
} from '@/domains/finance/actions'
import { CASH_WARNING_CENTS, proposeAllocation } from '@/domains/finance/rules'
import { PAYMENT_MODES, PAYMENT_MODE_LABELS } from '@/domains/finance/schemas'
import type { FormState } from '@/lib/form-state'
import { formatEurosInput, formatCents, parseEuros } from '@/lib/money'
import { formatMonthFr } from '@/lib/dates'

export interface OpenCharge {
  id: string
  leaseId: string
  periodStart: string
  dueOn: string
  balanceCents: number
}

const modeOptions = PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] }))

function PaymentFields({
  state,
  pending,
  leases,
  charges,
  initialLeaseId,
}: {
  state: FormState
  pending: boolean
  leases: { id: string; label: string }[]
  charges: OpenCharge[]
  initialLeaseId: string
}) {
  const [leaseId, setLeaseId] = useState(state.values?.leaseId ?? initialLeaseId)
  const [amount, setAmount] = useState(state.values?.amount ?? '')
  const [mode, setMode] = useState(state.values?.mode ?? 'transfer')
  const [edited, setEdited] = useState<Record<string, string>>({})

  const open = charges.filter((c) => c.leaseId === leaseId)
  const cents = parseEuros(amount)
  const proposal = cents && cents > 0 ? proposeAllocation(cents, open.map((c) => ({ id: c.id, dueDate: c.dueOn, balanceCents: c.balanceCents }))) : { allocations: [], unallocatedCents: 0 }
  const proposed = new Map(proposal.allocations.map((a) => [a.chargeId, a.amountCents]))
  const valueOf = (id: string) => edited[id] ?? state.values?.[`alloc_${id}`] ?? (proposed.has(id) ? formatEurosInput(proposed.get(id)!) : '')

  const typed = open.reduce((sum, c) => sum + (parseEuros(valueOf(c.id)) ?? 0), 0)
  const rest = cents === null ? 0 : cents - typed
  const cashWarning = mode === 'cash' && cents !== null && cents >= CASH_WARNING_CENTS

  return (
    <>
      <FormMessages state={state} />
      <div className="grid gap-1.5">
        <Label htmlFor="payment-lease">Bail</Label>
        <select
          id="payment-lease"
          name="leaseId"
          value={leaseId}
          onChange={(e) => {
            setLeaseId(e.target.value)
            setEdited({})
          }}
          aria-invalid={state.fieldErrors?.leaseId ? true : undefined}
          className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm"
        >
          <option value="">Choisir un bail…</option>
          {leases.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        {state.fieldErrors?.leaseId && <p className="text-destructive text-sm">{state.fieldErrors.leaseId[0]}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="payment-amount">Montant reçu (€)</Label>
          <input
            id="payment-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setEdited({})
            }}
            aria-invalid={state.fieldErrors?.amount ? true : undefined}
            className="border-input h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base"
          />
          {state.fieldErrors?.amount && <p className="text-destructive text-sm">{state.fieldErrors.amount[0]}</p>}
        </div>
        <TextField name="receivedOn" label="Date de réception" type="date" state={state} defaultValue="" required />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="payment-mode">Mode de paiement</Label>
        <select id="payment-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm">
          {modeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {cashWarning && (
        <div role="alert" className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Paiement en espèces de 1 000 € ou plus : le plafond légal est de 1 000 € pour un débiteur domicilié en France. Vérifiez le montant avant de confirmer.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" name="confirmCash" className="size-4" />
            Je confirme ce paiement en espèces
          </label>
          {state.fieldErrors?.confirmCash && <p className="text-destructive mt-1">{state.fieldErrors.confirmCash[0]}</p>}
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Affectation aux échéances (de la plus ancienne à la plus récente)</legend>
        {leaseId === '' && <p className="text-muted-foreground text-sm">Choisissez un bail pour voir ses échéances à régler.</p>}
        {leaseId !== '' && open.length === 0 && <p className="text-muted-foreground text-sm">Aucune échéance à régler : le paiement restera non affecté.</p>}
        {open
          .toSorted((a, b) => (a.dueOn < b.dueOn ? -1 : 1))
          .map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
              <Label htmlFor={`alloc-${c.id}`} className="font-normal">
                {formatMonthFr(c.periodStart)} · échue le {c.dueOn.split('-').reverse().join('/')} · reste {formatCents(c.balanceCents)}
              </Label>
              <input
                id={`alloc-${c.id}`}
                name={`alloc_${c.id}`}
                inputMode="decimal"
                autoComplete="off"
                value={valueOf(c.id)}
                onChange={(e) => setEdited((prev) => ({ ...prev, [c.id]: e.target.value }))}
                className="border-input h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base"
                aria-label={`Montant affecté à ${formatMonthFr(c.periodStart)}`}
              />
            </div>
          ))}
        {state.fieldErrors?.allocations && <p className="text-destructive text-sm">{state.fieldErrors.allocations[0]}</p>}
        {cents !== null && cents > 0 && (
          <p className="text-muted-foreground text-sm" data-testid="unallocated">
            Reste non affecté : {formatCents(Math.max(rest, 0))}
          </p>
        )}
      </fieldset>

      <TextField name="reference" label="Référence (facultative)" state={state} autoComplete="off" />
      <TextField name="comment" label="Commentaire (facultatif)" state={state} autoComplete="off" />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? 'Enregistrement…' : 'Enregistrer le paiement'}
      </Button>
    </>
  )
}

export function PaymentForm({ entityId, leases, charges, initialLeaseId }: { entityId: string; leases: { id: string; label: string }[]; charges: OpenCharge[]; initialLeaseId: string }) {
  return (
    <ActionForm action={recordPaymentAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <PaymentFields state={state} pending={pending} leases={leases} charges={charges} initialLeaseId={initialLeaseId} />
        </>
      )}
    </ActionForm>
  )
}

export function UpdatePaymentForm({
  entityId,
  paymentId,
  reference,
  comment,
  mode,
  receivedOn,
}: {
  entityId: string
  paymentId: string
  reference: string | null
  comment: string | null
  mode: string
  receivedOn: string
}) {
  return (
    <ActionForm action={updatePaymentAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <FormMessages state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="mode" label="Mode de paiement" state={state} defaultValue={mode} options={modeOptions} />
            <TextField name="receivedOn" label="Date de réception" type="date" state={state} defaultValue={receivedOn} required />
          </div>
          <TextField name="reference" label="Référence" state={state} defaultValue={reference} autoComplete="off" />
          <TextField name="comment" label="Commentaire" state={state} defaultValue={comment} autoComplete="off" />
          <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
            Enregistrer les corrections
          </Button>
        </>
      )}
    </ActionForm>
  )
}

/** Action avec motif obligatoire (annuler un paiement ou une échéance, retirer une affectation). */
export function ReasonForm({
  action,
  hidden,
  label,
  button,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  hidden: Record<string, string>
  label: string
  button: string
}) {
  return (
    <ActionForm action={action} className="grid gap-2">
      {(state, pending) => (
        <>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <FormMessages state={state} />
          <TextField name="reason" label={label} state={state} autoComplete="off" required />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            {button}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export const CancelPaymentForm = ({ entityId, paymentId }: { entityId: string; paymentId: string }) => (
  <ReasonForm action={cancelPaymentAction} hidden={{ entityId, paymentId }} label="Motif de l'annulation du paiement" button="Annuler ce paiement" />
)

export const ReverseAllocationForm = ({ entityId, paymentId, allocationId, name }: { entityId: string; paymentId: string; allocationId: string; name: string }) => (
  <ReasonForm action={reverseAllocationAction} hidden={{ entityId, paymentId, allocationId }} label={`Motif du retrait (${name})`} button={`Retirer l'affectation ${name}`} />
)

export const CancelChargeForm = ({ entityId, chargeId, name }: { entityId: string; chargeId: string; name: string }) => (
  <ReasonForm action={cancelChargeAction} hidden={{ entityId, chargeId }} label={`Motif de l'annulation (${name})`} button={`Annuler l'échéance ${name}`} />
)

export function RecalcChargeForm({ entityId, chargeId, name }: { entityId: string; chargeId: string; name: string }) {
  return (
    <ActionForm action={recalcChargeAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="chargeId" value={chargeId} />
          <FormMessages state={state} />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            {`Recalculer l'échéance ${name}`}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function MoveAllocationForm({
  entityId,
  paymentId,
  allocationId,
  name,
  targets,
}: {
  entityId: string
  paymentId: string
  allocationId: string
  name: string
  targets: { id: string; label: string }[]
}) {
  return (
    <ActionForm action={moveAllocationAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <input type="hidden" name="allocationId" value={allocationId} />
          <FormMessages state={state} />
          <SelectField name="chargeId" label={`Déplacer (${name}) vers`} state={state} options={[{ value: '', label: 'Choisir une échéance…' }, ...targets.map((t) => ({ value: t.id, label: t.label }))]} />
          <TextField name="reason" label="Motif du déplacement" state={state} autoComplete="off" required />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            {`Déplacer l'affectation ${name}`}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function AllocateRemainingForm({ entityId, paymentId, remainingCents, charges }: { entityId: string; paymentId: string; remainingCents: number; charges: OpenCharge[] }) {
  const proposal = proposeAllocation(
    remainingCents,
    charges.map((c) => ({ id: c.id, dueDate: c.dueOn, balanceCents: c.balanceCents })),
  )
  const proposed = new Map(proposal.allocations.map((a) => [a.chargeId, a.amountCents]))
  return (
    <ActionForm action={allocateRemainingAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <FormMessages state={state} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm">Affecter le reste ({formatCents(remainingCents)}) aux échéances à régler :</legend>
            {charges
              .toSorted((a, b) => (a.dueOn < b.dueOn ? -1 : 1))
              .map((c) => (
                <div key={c.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                  <Label htmlFor={`rest-${c.id}`} className="font-normal">
                    {formatMonthFr(c.periodStart)} · reste {formatCents(c.balanceCents)}
                  </Label>
                  <input
                    id={`rest-${c.id}`}
                    name={`alloc_${c.id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={proposed.has(c.id) ? formatEurosInput(proposed.get(c.id)!) : ''}
                    className="border-input h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base"
                    aria-label={`Montant affecté à ${formatMonthFr(c.periodStart)}`}
                  />
                </div>
              ))}
          </fieldset>
          <Button type="submit" disabled={pending} className="justify-self-start">
            Affecter
          </Button>
        </>
      )}
    </ActionForm>
  )
}
