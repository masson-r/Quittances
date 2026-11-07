'use client'

import { useActionState, useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { acceptInvitationAction, type MemberFormState } from '@/domains/identity/members-actions'

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, {} as MemberFormState)
  // Faux au rendu serveur, vrai une fois la page hydratée : les tests n'agissent qu'ensuite.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  return (
    <form action={action} className="grid gap-4" data-hydrated={hydrated}>
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm">
        Vous êtes connecté avec <strong>{email}</strong>. L&apos;invitation ne fonctionne qu&apos;avec l&apos;adresse e-mail à laquelle elle est destinée.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? 'Vérification…' : "Accepter l'invitation"}
      </Button>
    </form>
  )
}
