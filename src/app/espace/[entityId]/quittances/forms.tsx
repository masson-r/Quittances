'use client'

import { Button } from '@/components/ui/button'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, TextField } from '@/components/forms/fields'
import { cancelReceiptAction, finalizeReceiptAction, issueReceiptAction, replaceReceiptAction } from '@/domains/receipts/actions'

export function IssueForm({
  entityId,
  kind,
  rentChargeId,
  paymentId,
  defaultPaidOn,
  label,
}: {
  entityId: string
  kind: string
  rentChargeId: string
  paymentId: string | null
  defaultPaidOn: string | null
  label: string
}) {
  return (
    <ActionForm action={issueReceiptAction} className="grid gap-3">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="rentChargeId" value={rentChargeId} />
          <input type="hidden" name="paymentId" value={paymentId ?? ''} />
          <FormMessages state={state} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="issuedOn" label="Date d'émission" type="date" state={state} idPrefix={`${rentChargeId}${paymentId ?? ''}`} hint="Aujourd'hui si vide." />
            <TextField
              name="paidOn"
              label="Date de paiement"
              type="date"
              state={state}
              defaultValue={defaultPaidOn}
              idPrefix={`${rentChargeId}${paymentId ?? ''}`}
              hint="Réception du dernier règlement par défaut."
            />
          </div>
          <div>
            <Button type="submit" disabled={pending} aria-label={`Émettre : ${label}`}>
              {pending ? 'Émission…' : 'Émettre'}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function FinalizeForm({ entityId, receiptId, number }: { entityId: string; receiptId: string; number: string }) {
  return (
    <ActionForm action={finalizeReceiptAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="receiptId" value={receiptId} />
          <FormMessages state={state} />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Générer le fichier de ${number}`}>
              Générer le fichier
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function CancelForm({ entityId, receiptId, number }: { entityId: string; receiptId: string; number: string }) {
  return (
    <ActionForm action={cancelReceiptAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="receiptId" value={receiptId} />
          <FormMessages state={state} />
          <TextField name="reason" label="Motif de l'annulation" state={state} idPrefix={receiptId} required />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Annuler ${number}`}>
              Annuler le document
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function ReplaceForm({ entityId, receiptId, number, paidOn }: { entityId: string; receiptId: string; number: string; paidOn: string }) {
  return (
    <ActionForm action={replaceReceiptAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="receiptId" value={receiptId} />
          <FormMessages state={state} />
          <TextField name="reason" label="Motif du remplacement" state={state} idPrefix={`r${receiptId}`} required />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="issuedOn" label="Date d'émission" type="date" state={state} idPrefix={`r${receiptId}`} hint="Aujourd'hui si vide." />
            <TextField name="paidOn" label="Date de paiement" type="date" state={state} defaultValue={paidOn} idPrefix={`r${receiptId}`} />
          </div>
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Remplacer ${number}`}>
              Remplacer le document
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}
