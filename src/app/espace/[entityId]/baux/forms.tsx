'use client'

import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, SelectField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { addCoTenantAction, addTermAction, createLeaseAction, endLeaseAction, endPresenceAction } from '@/domains/leasing/actions'

interface Option {
  id: string
  label: string
}

export function NewLeaseForm({ entityId, properties, tenants }: { entityId: string; properties: Option[]; tenants: Option[] }) {
  return (
    <ActionForm action={createLeaseAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <FormMessages state={state} />
          <SelectField
            name="propertyId"
            label="Bien loué"
            state={state}
            options={[{ value: '', label: 'Choisir un bien…' }, ...properties.map((p) => ({ value: p.id, label: p.label }))]}
          />
          <fieldset className="grid gap-2" aria-describedby={state.fieldErrors?.tenantIds ? 'tenantIds-error' : undefined}>
            <legend className="mb-1 text-sm font-medium">Locataires (cochez tous les colocataires)</legend>
            {tenants.length === 0 && <p className="text-muted-foreground text-sm">Aucun dossier locataire : créez-en un d&apos;abord.</p>}
            {tenants.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  key={`${t.id}-${state.values?.tenantIds ?? ''}`}
                  type="checkbox"
                  name="tenantIds"
                  value={t.id}
                  defaultChecked={(state.values?.tenantIds ?? '').split(',').includes(t.id)}
                  className="size-4"
                />
                {t.label}
              </label>
            ))}
            {state.fieldErrors?.tenantIds && (
              <p id="tenantIds-error" className="text-destructive text-sm">
                {state.fieldErrors.tenantIds[0]}
              </p>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="startDate" label="Date de début" type="date" state={state} defaultValue="" required />
            <TextField name="endDate" label="Date de fin (facultative)" type="date" state={state} defaultValue="" />
          </div>
          <TextField name="dueDay" label="Jour d'échéance du loyer" state={state} inputMode="numeric" required hint="De 1 à 31. Les jours 29 à 31 tombent le dernier jour des mois plus courts." autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="rent" label="Loyer mensuel (€)" state={state} inputMode="decimal" required autoComplete="off" />
            <TextField name="charges" label="Provisions pour charges (€)" state={state} inputMode="decimal" required autoComplete="off" hint="0 s'il n'y en a pas." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="deposit" label="Dépôt de garantie (€, facultatif)" state={state} inputMode="decimal" autoComplete="off" hint="Information seulement : aucun calcul n'en découle." />
            <TextField name="depositReceivedOn" label="Date de réception du dépôt" type="date" state={state} defaultValue="" />
          </div>
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? 'Création…' : 'Créer le bail'}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function TermForm({ entityId, leaseId }: { entityId: string; leaseId: string }) {
  return (
    <ActionForm action={addTermAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <FormMessages state={state} />
          <TextField name="effectiveFrom" label="Date d'effet" type="date" state={state} defaultValue="" required hint="S'applique à la première période qui commence à cette date ou après." />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="rent" label="Nouveau loyer (€)" state={state} inputMode="decimal" required autoComplete="off" />
            <TextField name="charges" label="Nouvelles charges (€)" state={state} inputMode="decimal" required autoComplete="off" />
          </div>
          <TextField name="reason" label="Motif (facultatif)" state={state} autoComplete="off" />
          <Button type="submit" disabled={pending} className="justify-self-start">
            Ajouter une version
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function CoTenantForm({ entityId, leaseId, tenants }: { entityId: string; leaseId: string; tenants: Option[] }) {
  return (
    <ActionForm action={addCoTenantAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <FormMessages state={state} />
          <SelectField
            name="tenantId"
            label="Locataire à ajouter"
            state={state}
            options={[{ value: '', label: 'Choisir un locataire…' }, ...tenants.map((t) => ({ value: t.id, label: t.label }))]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="startDate" label="Date d'entrée" type="date" state={state} defaultValue="" required />
            <TextField name="endDate" label="Date de sortie (facultative)" type="date" state={state} defaultValue="" />
          </div>
          <Button type="submit" disabled={pending} className="justify-self-start">
            Ajouter au bail
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function EndPresenceForm({ entityId, leaseId, presenceId, name }: { entityId: string; leaseId: string; presenceId: string; name: string }) {
  return (
    <ActionForm action={endPresenceAction} className="flex flex-wrap items-end gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="presenceId" value={presenceId} />
          <div className="w-44">
            <TextField idPrefix={`presence-${presenceId}-`} name="endDate" label={`Sortie de ${name}`} type="date" state={state} defaultValue="" />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {`Enregistrer la sortie de ${name}`}
          </Button>
          <FormMessages state={state} />
        </>
      )}
    </ActionForm>
  )
}

export function EndLeaseForm({ entityId, leaseId }: { entityId: string; leaseId: string }) {
  return (
    <ActionForm action={endLeaseAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <FormMessages state={state} />
          <TextField name="endDate" label="Date de fin du bail" type="date" state={state} defaultValue="" required hint="Les colocataires encore présents sortent à cette date." />
          <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
            Mettre fin au bail
          </Button>
        </>
      )}
    </ActionForm>
  )
}
