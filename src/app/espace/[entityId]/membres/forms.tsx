'use client'

import { useActionState, useEffect, useState, useTransition, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  changeRoleAction,
  inviteMemberAction,
  revokeInvitationAction,
  setMemberStatusAction,
  type MemberFormState,
} from '@/domains/identity/members-actions'
import { ROLES, roleLabel } from '@/domains/identity/roles'

const initial: MemberFormState = {}

/**
 * Formulaire dont le résultat (lien d'invitation en clair) vit dans l'état local, vidé quand on quitte la page :
 * Next conserve l'état des pages quittées, le lien ne doit pas réapparaître.
 */
function useTransientForm(action: (state: MemberFormState, data: FormData) => Promise<MemberFormState>) {
  const [state, setState] = useState<MemberFormState>(initial)
  const [pending, startTransition] = useTransition()
  useEffect(() => () => setState(initial), [])
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(async () => setState(await action(initial, data)))
  }
  return { state, pending, onSubmit }
}

function Feedback({ state }: { state: MemberFormState }) {
  if (state.error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    )
  }
  if (state.success && !state.link) {
    return (
      <p role="status" className="text-sm">
        {state.success}
      </p>
    )
  }
  return null
}

function RoleSelect({ id, defaultValue, label }: { id: string; defaultValue?: string; label: string }) {
  return (
    <select
      id={id}
      name="role"
      defaultValue={defaultValue ?? 'reader'}
      aria-label={label}
      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
    >
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </select>
  )
}

/** Lien d'invitation : affiché une seule fois, effacé quand on quitte la page. */
function InviteLink({ link, email }: { link: string; email?: string }) {
  return (
    <Alert role="status">
      <AlertDescription className="grid gap-2">
        <span>
          Transmettez ce lien à {email ?? 'la personne invitée'} seulement. Il ne sera plus affiché : en cas de perte, régénérez l&apos;invitation.
        </span>
        <Input readOnly value={link} aria-label="Lien d'invitation" data-testid="invitation-link" onFocus={(e) => e.currentTarget.select()} />
      </AlertDescription>
    </Alert>
  )
}

export function InviteForm({ entityId }: { entityId: string }) {
  const { state, pending, onSubmit } = useTransientForm(inviteMemberAction)
  const errors = state.fieldErrors
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <input type="hidden" name="entityId" value={entityId} />
      <Feedback state={state} />
      {state.link && <InviteLink link={state.link} />}
      <div className="grid gap-1.5">
        <Label htmlFor="invite-email">Adresse e-mail de la personne invitée</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          aria-invalid={errors?.email ? true : undefined}
          aria-describedby={errors?.email ? 'invite-email-error' : undefined}
        />
        {errors?.email && (
          <p id="invite-email-error" className="text-destructive text-sm">
            {errors.email[0]}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="invite-role">Rôle</Label>
        <RoleSelect id="invite-role" label="Rôle" />
        {errors?.role && <p className="text-destructive text-sm">{errors.role[0]}</p>}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Création…' : "Créer l'invitation"}
      </Button>
    </form>
  )
}

export function PendingInvitationActions({ entityId, invitationId, email, role }: { entityId: string; invitationId: string; email: string; role: string }) {
  const revoke = useTransientForm(revokeInvitationAction)
  const renew = useTransientForm(inviteMemberAction)

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <form onSubmit={renew.onSubmit}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="role" value={role} />
          <Button type="submit" variant="outline" size="sm" disabled={renew.pending} aria-label={`Régénérer l'invitation de ${email}`}>
            Régénérer
          </Button>
        </form>
        <form onSubmit={revoke.onSubmit}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="invitationId" value={invitationId} />
          <Button type="submit" variant="outline" size="sm" disabled={revoke.pending} aria-label={`Révoquer l'invitation de ${email}`}>
            Révoquer
          </Button>
        </form>
      </div>
      <Feedback state={revoke.state} />
      <Feedback state={renew.state} />
      {renew.state.link && <InviteLink link={renew.state.link} email={email} />}
    </div>
  )
}

export function MemberActions({
  entityId,
  membershipId,
  role,
  status,
  label,
}: {
  entityId: string
  membershipId: string
  role: string
  status: string
  label: string
}) {
  const [roleState, roleAction, changing] = useActionState(changeRoleAction, initial)
  const [statusState, statusAction, toggling] = useActionState(setMemberStatusAction, initial)
  const nextStatus = status === 'active' ? 'suspended' : 'active'

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={roleAction} className="flex gap-2">
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <RoleSelect id={`role-${membershipId}`} defaultValue={role} label={`Rôle de ${label}`} />
          <Button type="submit" variant="outline" size="sm" disabled={changing} aria-label={`Enregistrer le rôle de ${label}`}>
            Enregistrer
          </Button>
        </form>
        <form action={statusAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="status" value={nextStatus} />
          <Button type="submit" variant="outline" size="sm" disabled={toggling} aria-label={`${status === 'active' ? 'Suspendre' : 'Réactiver'} ${label}`}>
            {status === 'active' ? 'Suspendre' : 'Réactiver'}
          </Button>
        </form>
      </div>
      <Feedback state={roleState} />
      <Feedback state={statusState} />
    </div>
  )
}
