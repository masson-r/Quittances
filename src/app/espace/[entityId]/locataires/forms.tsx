'use client'

import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, SelectField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { anonymizeTenantAction, createTenantAction, savePrivateDetailsAction, setTenantArchivedAction, updateTenantAction } from '@/domains/tenants/actions'
import { GUARANTOR_KINDS, GUARANTOR_LABELS, HOUSING_AIDS, HOUSING_AID_LABELS } from '@/domains/tenants/schemas'
import type { PrivateDetails, Tenant } from '@/domains/tenants/service'

export function TenantForm({ entityId, tenant }: { entityId: string; tenant?: Tenant }) {
  return (
    <ActionForm action={tenant ? updateTenantAction : createTenantAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          {tenant && <input type="hidden" name="tenantId" value={tenant.id} />}
          <FormMessages state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="lastName" label="Nom" state={state} defaultValue={tenant?.lastName} required autoComplete="off" />
            <TextField name="firstName" label="Prénom" state={state} defaultValue={tenant?.firstName} autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="email" label="Adresse e-mail" type="email" state={state} defaultValue={tenant?.email} autoComplete="off" />
            <TextField name="phone" label="Téléphone" type="tel" state={state} defaultValue={tenant?.phone} autoComplete="off" />
          </div>
          <TextField name="addressLine1" label="Adresse" state={state} defaultValue={tenant?.addressLine1} autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <TextField name="postalCode" label="Code postal" state={state} defaultValue={tenant?.postalCode} inputMode="numeric" autoComplete="off" />
            <TextField name="city" label="Ville" state={state} defaultValue={tenant?.city} autoComplete="off" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="paperDeliveryRequested" defaultChecked={tenant?.paperDeliveryRequested} className="size-4" />
            Remise papier demandée (pas de remise dématérialisée)
          </label>
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? 'Enregistrement…' : tenant ? 'Enregistrer' : 'Créer le dossier'}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function PrivateDetailsForm({ entityId, tenantId, details }: { entityId: string; tenantId: string; details: PrivateDetails | null }) {
  return (
    <ActionForm action={savePrivateDetailsAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <FormMessages state={state} />
          <TextField
            name="birthDate"
            label="Date de naissance (facultative)"
            state={state}
            defaultValue={details?.birthDate}
            hint="Format AAAA-MM-JJ. Elle ne figure jamais sur les quittances."
            autoComplete="off"
          />
          <SelectField
            name="guarantorKind"
            label="Garant"
            state={state}
            defaultValue={details?.guarantorKind ?? 'none'}
            options={GUARANTOR_KINDS.map((k) => ({ value: k, label: GUARANTOR_LABELS[k] }))}
          />
          <TextField name="guarantorName" label="Nom du garant" state={state} defaultValue={details?.guarantorName} autoComplete="off" />
          <TextField name="guarantorContact" label="Coordonnées du garant" state={state} defaultValue={details?.guarantorContact} autoComplete="off" />
          <SelectField
            name="housingAid"
            label="Aide au logement"
            state={state}
            defaultValue={details?.housingAid ?? 'none'}
            options={HOUSING_AIDS.map((k) => ({ value: k, label: HOUSING_AID_LABELS[k] }))}
          />
          <TextField name="note" label="Note" state={state} defaultValue={details?.note} multiline />
          <Button type="submit" disabled={pending} className="justify-self-start">
            Enregistrer les informations sensibles
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function ArchiveTenantForm({ entityId, tenantId, archived }: { entityId: string; tenantId: string; archived: boolean }) {
  return (
    <ActionForm action={setTenantArchivedAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="archive" value={archived ? 'false' : 'true'} />
          <FormMessages state={state} />
          <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
            {archived ? 'Restaurer le dossier' : 'Archiver le dossier'}
          </Button>
          {!archived && <p className="text-muted-foreground text-sm">Un dossier n&apos;est jamais supprimé : archivé, il disparaît des listes mais ses baux et quittances restent consultables.</p>}
        </>
      )}
    </ActionForm>
  )
}

export function AnonymizeTenantForm({ entityId, tenantId }: { entityId: string; tenantId: string }) {
  return (
    <ActionForm action={anonymizeTenantAction} className="grid max-w-md gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <FormMessages state={state} />
          <p className="text-muted-foreground text-sm">
            Efface définitivement le nom, les coordonnées et les informations sensibles du dossier. Possible trois ans après la fin du dernier bail, une fois
            l&apos;apurement final saisi. Les baux, paiements et quittances sont conservés.
          </p>
          <TextField name="confirm" label="Tapez ANONYMISER pour confirmer" state={state} idPrefix="anon-" />
          <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
            Anonymiser le dossier
          </Button>
        </>
      )}
    </ActionForm>
  )
}
