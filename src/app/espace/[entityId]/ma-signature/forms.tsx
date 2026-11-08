'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages } from '@/components/forms/fields'
import { removeSignatureAction, uploadSignatureAction } from '@/domains/signatures/actions'

export function UploadSignatureForm({ entityId, replacing }: { entityId: string; replacing: boolean }) {
  return (
    <ActionForm action={uploadSignatureAction} className="grid max-w-md gap-3">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <FormMessages state={state} />
          <div className="grid gap-1.5">
            <Label htmlFor="signature">{replacing ? 'Nouvelle image de signature' : 'Image de signature'}</Label>
            <input
              id="signature"
              name="signature"
              type="file"
              accept="image/png,image/jpeg"
              aria-describedby="signature-hint"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <p id="signature-hint" className="text-muted-foreground text-sm">
              PNG ou JPEG, 500 Ko et 1 200 × 600 pixels au maximum. Les métadonnées de l&apos;image sont supprimées.
            </p>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Envoi…' : replacing ? 'Remplacer la signature' : 'Enregistrer la signature'}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function RemoveSignatureForm({ entityId }: { entityId: string }) {
  return (
    <ActionForm action={removeSignatureAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <FormMessages state={state} />
          <div>
            <Button type="submit" variant="outline" disabled={pending}>
              Retirer ma signature
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}
