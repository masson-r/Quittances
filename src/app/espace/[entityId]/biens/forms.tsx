'use client'

import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import {
  addMaintenanceNoteAction,
  createPropertyAction,
  deleteAccessCodeAction,
  saveAccessCodeAction,
  setPropertyArchivedAction,
  updatePropertyAction,
} from '@/domains/properties/actions'
import type { AccessCode, Property } from '@/domains/properties/service'

export function PropertyForm({ entityId, property }: { entityId: string; property?: Property }) {
  return (
    <ActionForm action={property ? updatePropertyAction : createPropertyAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          {property && <input type="hidden" name="propertyId" value={property.id} />}
          <FormMessages state={state} />
          <TextField name="label" label="Libellé du bien" state={state} defaultValue={property?.label} required hint="Par exemple « T3 rue des Lilas »." />
          <TextField name="addressLine1" label="Adresse" state={state} defaultValue={property?.addressLine1} required autoComplete="off" />
          <TextField name="addressLine2" label="Complément d'adresse" state={state} defaultValue={property?.addressLine2} autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <TextField name="postalCode" label="Code postal" state={state} defaultValue={property?.postalCode} required inputMode="numeric" autoComplete="off" />
            <TextField name="city" label="Ville" state={state} defaultValue={property?.city} required autoComplete="off" />
          </div>
          <TextField name="description" label="Description" state={state} defaultValue={property?.description} multiline />
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? 'Enregistrement…' : property ? 'Enregistrer' : 'Créer le bien'}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function ArchiveForm({ entityId, propertyId, archived }: { entityId: string; propertyId: string; archived: boolean }) {
  return (
    <ActionForm action={setPropertyArchivedAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="archive" value={archived ? 'false' : 'true'} />
          <FormMessages state={state} />
          <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
            {archived ? 'Restaurer le bien' : 'Archiver le bien'}
          </Button>
          {!archived && <p className="text-muted-foreground text-sm">Un bien n&apos;est jamais supprimé : archivé, il disparaît des listes mais son historique reste consultable.</p>}
        </>
      )}
    </ActionForm>
  )
}

export function NoteForm({ entityId, propertyId }: { entityId: string; propertyId: string }) {
  return (
    <ActionForm action={addMaintenanceNoteAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="propertyId" value={propertyId} />
          <FormMessages state={state} />
          <TextField name="body" label="Nouvelle note de maintenance" state={state} multiline required hint="Une note ne se modifie pas : pour corriger, ajoutez une nouvelle note." />
          <Button type="submit" disabled={pending} className="justify-self-start">
            Ajouter la note
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function AccessCodeForm({ entityId, propertyId, code }: { entityId: string; propertyId: string; code?: AccessCode }) {
  const prefix = code ? `code-${code.id}-` : 'code-new-'
  return (
    <ActionForm action={saveAccessCodeAction}>
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="propertyId" value={propertyId} />
          {code && <input type="hidden" name="codeId" value={code.id} />}
          <FormMessages state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField idPrefix={prefix} name="label" label="Libellé" state={state} defaultValue={code?.label} required />
            <TextField idPrefix={prefix} name="code" label="Code" state={state} defaultValue={code?.code} required autoComplete="off" />
          </div>
          <TextField idPrefix={prefix} name="note" label="Note" state={state} defaultValue={code?.note} />
          <Button type="submit" variant={code ? 'outline' : 'default'} disabled={pending} className="justify-self-start">
            {code ? `Enregistrer le code « ${code.label} »` : 'Ajouter le code'}
          </Button>
        </>
      )}
    </ActionForm>
  )
}

export function DeleteCodeForm({ entityId, propertyId, code }: { entityId: string; propertyId: string; code: AccessCode }) {
  return (
    <ActionForm action={deleteAccessCodeAction} className="grid gap-1">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="codeId" value={code.id} />
          <FormMessages state={state} />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
            {`Supprimer le code « ${code.label} »`}
          </Button>
        </>
      )}
    </ActionForm>
  )
}
