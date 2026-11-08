'use client'

import { useActionState, useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, TextField } from '@/components/forms/fields'
import {
  decideAccessAction,
  inviteTenantAction,
  requestAccessAction,
  revokeAccessAction,
  updateContactAction,
  withdrawConsentAction,
  type AccessFormState,
} from '@/domains/tenant-access/actions'
import { CONSENT_TEXT } from '@/domains/tenant-access/consent'
import type { MyDossier } from '@/domains/tenant-access/service'

const initial: AccessFormState = {}
const noop = () => () => {}

/** Bouton d'action (valider, refuser, révoquer, retirer le consentement) avec retour d'état. */
function ActionButton({
  action,
  fields,
  label,
  ariaLabel,
  confirm,
}: {
  action: (state: AccessFormState, data: FormData) => Promise<AccessFormState>
  fields: Record<string, string>
  label: string
  ariaLabel: string
  confirm?: string
}) {
  const [state, dispatch, pending] = useActionState(action, initial)
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  return (
    <form
      action={dispatch}
      data-hydrated={hydrated}
      className="grid gap-1"
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault()
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={ariaLabel}>
        {label}
      </Button>
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm">
          {state.success}
        </p>
      )}
    </form>
  )
}

export function DecideButtons({ entityId, requestId, who }: { entityId: string; requestId: string; who: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={decideAccessAction} fields={{ entityId, requestId, decision: 'approve' }} label="Valider" ariaLabel={`Valider la demande de ${who}`} />
      <ActionButton action={decideAccessAction} fields={{ entityId, requestId, decision: 'refuse' }} label="Refuser" ariaLabel={`Refuser la demande de ${who}`} />
    </div>
  )
}

export function RevokeButton({ entityId, requestId, who }: { entityId: string; requestId: string; who: string }) {
  return (
    <ActionButton
      action={revokeAccessAction}
      fields={{ entityId, requestId }}
      label="Révoquer l'accès"
      ariaLabel={`Révoquer l'accès de ${who}`}
      confirm="Révoquer cet accès ? Le locataire ne verra plus ses documents immédiatement."
    />
  )
}

export function DetachButton({ requestId, entityName }: { requestId: string; entityName: string }) {
  return (
    <ActionButton
      action={revokeAccessAction}
      fields={{ requestId }}
      label="Me détacher"
      ariaLabel={`Me détacher de ${entityName}`}
      confirm="Vous ne verrez plus vos documents tant que le propriétaire ne vous aura pas réinvité. Continuer ?"
    />
  )
}

export function WithdrawConsentButton({ requestId, entityName }: { requestId: string; entityName: string }) {
  return (
    <ActionButton
      action={withdrawConsentAction}
      fields={{ requestId }}
      label="Retirer mon consentement"
      ariaLabel={`Retirer mon consentement à la remise dématérialisée (${entityName})`}
      confirm="Vos nouvelles quittances ne seront plus mises à disposition en ligne. Continuer ?"
    />
  )
}

/** Création du lien d'invitation : affiché une seule fois, effacé quand on quitte la page. */
export function InviteTenantForm({ entityId, tenantId, renew }: { entityId: string; tenantId: string; renew: boolean }) {
  const [state, setState] = useState<AccessFormState>(initial)
  const [pending, startTransition] = useTransition()
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  useEffect(() => () => setState(initial), [])
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(async () => setState(await inviteTenantAction(initial, data)))
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3" data-hydrated={hydrated}>
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.link && (
        <Alert role="status">
          <AlertDescription className="grid gap-2">
            <span>Transmettez ce lien au locataire seulement. Il ne sera plus affiché : en cas de perte, régénérez-le.</span>
            <Input readOnly value={state.link} aria-label="Lien de rattachement" data-testid="tenant-invitation-link" onFocus={(e) => e.currentTarget.select()} />
          </AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Création…' : renew ? 'Régénérer le lien' : "Créer un lien d'accès"}
        </Button>
      </div>
    </form>
  )
}

/** Demande de rattachement : le consentement est obligatoire. */
export function RequestAccessForm({ token }: { token: string }) {
  return (
    <ActionForm action={requestAccessAction} className="grid gap-4">
      {(state, pending) => (
        <>
          <input type="hidden" name="token" value={token} />
          <FormMessages state={state} />
          <div className="flex items-start gap-3">
            <input id="consent" name="consent" type="checkbox" required className="mt-1 size-4" aria-describedby="consent-text" />
            <label htmlFor="consent" id="consent-text" className="text-sm">
              {CONSENT_TEXT}
            </label>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Envoi…' : 'Envoyer ma demande'}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function ContactForm({ dossier }: { dossier: MyDossier }) {
  return (
    <ActionForm action={updateContactAction} className="grid max-w-md gap-3">
      {(state, pending) => (
        <>
          <input type="hidden" name="tenantId" value={dossier.tenantId} />
          <FormMessages state={state} />
          <TextField name="phone" label="Téléphone" state={state} defaultValue={dossier.phone} autoComplete="tel" inputMode="tel" idPrefix={dossier.tenantId} />
          <TextField name="addressLine1" label="Adresse" state={state} defaultValue={dossier.addressLine1} autoComplete="address-line1" idPrefix={dossier.tenantId} />
          <TextField name="postalCode" label="Code postal" state={state} defaultValue={dossier.postalCode} autoComplete="postal-code" idPrefix={dossier.tenantId} />
          <TextField name="city" label="Ville" state={state} defaultValue={dossier.city} autoComplete="address-level2" idPrefix={dossier.tenantId} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer mes coordonnées'}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}
