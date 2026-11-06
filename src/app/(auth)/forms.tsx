'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  forgotPasswordAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type FormState,
} from '@/domains/identity/auth-actions'

const initial: FormState = {}

function Field({
  name,
  label,
  type = 'text',
  autoComplete,
  state,
  hint,
}: {
  name: string
  label: string
  type?: string
  autoComplete?: string
  state: FormState
  hint?: string
}) {
  const errors = state.fieldErrors?.[name]
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={errors ? true : undefined}
        aria-describedby={[errors ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
      />
      {hint && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {errors && (
        <p id={errorId} className="text-destructive text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

function Messages({ state }: { state: FormState }) {
  return (
    <>
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <Alert role="status">
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

const PASSWORD_HINT = '12 caractères minimum, avec une minuscule, une majuscule et un chiffre.'

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Messages state={state} />
      <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" state={state} />
      <Field name="password" label="Mot de passe" type="password" autoComplete="current-password" state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </Button>
      <p className="text-sm">
        <Link href="/mot-de-passe-oublie" className="underline">
          Mot de passe oublié ?
        </Link>
      </p>
    </form>
  )
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Messages state={state} />
      <Field name="firstName" label="Prénom" autoComplete="given-name" state={state} />
      <Field name="lastName" label="Nom" autoComplete="family-name" state={state} />
      <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" state={state} />
      <Field name="password" label="Mot de passe" type="password" autoComplete="new-password" state={state} hint={PASSWORD_HINT} />
      <Field name="confirmPassword" label="Confirmez le mot de passe" type="password" autoComplete="new-password" state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Création…' : 'Créer mon compte'}
      </Button>
    </form>
  )
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Messages state={state} />
      <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer le lien'}
      </Button>
    </form>
  )
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Messages state={state} />
      <Field name="password" label="Nouveau mot de passe" type="password" autoComplete="new-password" state={state} hint={PASSWORD_HINT} />
      <Field name="confirmPassword" label="Confirmez le mot de passe" type="password" autoComplete="new-password" state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>
  )
}
