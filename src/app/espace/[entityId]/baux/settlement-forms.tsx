'use client'

import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, SelectField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PAYMENT_MODES, PAYMENT_MODE_LABELS } from '@/domains/finance/schemas'
import { cancelSettlementAction, recordSettlementAction, updateSettlementAction } from '@/domains/settlements/actions'
import { SETTLEMENT_KINDS, SETTLEMENT_KIND_LABELS } from '@/domains/settlements/schemas'
import type { RefundablePayment, SettlementRow } from '@/domains/settlements/service'
import { formatDateFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'

const modeOptions = PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] }))

export function SettlementForm({ entityId, leaseId, payments }: { entityId: string; leaseId: string; payments: RefundablePayment[] }) {
  const [kind, setKind] = useState<string>('charges_adjustment')
  return (
    <ActionForm action={recordSettlementAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <FormMessages state={state} />
          <div className="grid gap-1.5">
            <Label htmlFor="settlement-kind">Nature</Label>
            <select
              id="settlement-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm"
            >
              {SETTLEMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SETTLEMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <TextField
            name="amount"
            label="Montant (€)"
            state={state}
            inputMode="decimal"
            autoComplete="off"
            required
            hint="Positif : remboursement versé au locataire. Négatif (par exemple -80) : complément de charges reçu du locataire. Zéro : seulement pour l'apurement final."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="settledOn" label="Date" type="date" state={state} defaultValue="" required />
            <SelectField name="mode" label="Mode" state={state} options={modeOptions} />
          </div>
          <TextField name="reason" label="Motif" state={state} autoComplete="off" required hint="Par exemple « Régularisation des charges 2025 »." />
          {kind === 'unallocated_refund' ? (
            <SelectField
              name="paymentId"
              label="Paiement à rembourser"
              state={state}
              options={[
                { value: '', label: 'Choisir un paiement…' },
                ...payments.map((p) => ({ value: p.id, label: `${formatDateFr(p.receivedOn)} · ${formatCents(p.amountCents)} · ${formatCents(p.remainingCents)} non affectés` })),
              ]}
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="periodStart" label="Début de la période régularisée (facultatif)" type="date" state={state} defaultValue="" />
                <TextField name="periodEnd" label="Fin de la période régularisée" type="date" state={state} defaultValue="" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isFinal" className="size-4" />
                Apurement final du bail (peut être nul)
              </label>
            </>
          )}
          <TextField name="reference" label="Référence (facultative)" state={state} autoComplete="off" />
          <TextField name="comment" label="Commentaire (facultatif)" state={state} autoComplete="off" />
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? 'Enregistrement…' : "Enregistrer l'apurement"}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function CancelSettlementForm({ entityId, leaseId, settlementId }: { entityId: string; leaseId: string; settlementId: string }) {
  return (
    <ActionForm action={cancelSettlementAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="settlementId" value={settlementId} />
          <FormMessages state={state} />
          <TextField name="reason" label="Motif de l'annulation de l'apurement" state={state} autoComplete="off" required />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            Annuler cet apurement
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function UpdateSettlementForm({ entityId, leaseId, row }: { entityId: string; leaseId: string; row: SettlementRow }) {
  return (
    <ActionForm action={updateSettlementAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="settlementId" value={row.id} />
          <FormMessages state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="settledOn" label="Date" type="date" state={state} defaultValue={row.settledOn} required />
            <SelectField name="mode" label="Mode" state={state} defaultValue={row.mode} options={modeOptions} />
          </div>
          <TextField name="reference" label="Référence" state={state} defaultValue={row.reference} autoComplete="off" />
          <TextField name="comment" label="Commentaire" state={state} defaultValue={row.comment} autoComplete="off" />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            Enregistrer les corrections
          </Button>
        </>
      )}
    </ActionForm>
  )
}
