'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  confirmEnrollmentAction,
  regenerateRecoveryCodesAction,
  startEnrollmentAction,
  redeemRecoveryCodeAction,
  verifyTotpAction,
  type EnrollmentStart,
  type MfaFormState,
} from '@/domains/identity/mfa-actions'

const initial: MfaFormState = {}

function CodeField({ state, label, hint, inputMode }: { state: MfaFormState; label: string; hint?: string; inputMode?: 'numeric' | 'text' }) {
  const errors = state.fieldErrors?.code
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="code">{label}</Label>
      <Input
        id="code"
        name="code"
        required
        autoComplete="one-time-code"
        inputMode={inputMode}
        aria-invalid={errors ? true : undefined}
        aria-describedby={[errors ? 'code-error' : null, hint ? 'code-hint' : null].filter(Boolean).join(' ') || undefined}
      />
      {hint && (
        <p id="code-hint" className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {errors && (
        <p id="code-error" className="text-destructive text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

function ErrorAlert({ message }: { message?: string }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="grid gap-3">
      <Alert role="status">
        <AlertDescription>
          Conservez ces 10 codes de secours dans un endroit sûr (gestionnaire de mots de passe, papier). Chacun ne sert qu&apos;une fois et ne sera plus
          jamais affiché.
        </AlertDescription>
      </Alert>
      <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="bg-muted rounded px-2 py-1">
            {code}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EnrollForm({ afterRecovery }: { afterRecovery: boolean }) {
  const [start, setStart] = useState<EnrollmentStart | null>(null)
  const [result, setResult] = useState<MfaFormState>({})
  const [pending, startTransition] = useTransition()

  // Next conserve l'état d'une page quittée : on le vide pour que ni le secret ni les codes de secours ne réapparaissent.
  useEffect(
    () => () => {
      setStart(null)
      setResult({})
    },
    [],
  )

  if (result.recoveryCodes) {
    return (
      <div className="grid gap-4">
        <h2 className="text-lg font-semibold">Second facteur activé</h2>
        <RecoveryCodes codes={result.recoveryCodes} />
        <Link href="/espace" className={buttonVariants()}>
          J&apos;ai conservé mes codes, continuer
        </Link>
      </div>
    )
  }

  if (!start?.factorId) {
    return (
      <div className="grid gap-4">
        {afterRecovery && (
          <Alert role="status">
            <AlertDescription>Votre ancien second facteur a été supprimé. Activez-en un nouveau pour continuer.</AlertDescription>
          </Alert>
        )}
        <ErrorAlert message={start?.error} />
        <Button type="button" disabled={pending} onClick={() => startTransition(async () => setStart(await startEnrollmentAction()))}>
          {pending ? 'Préparation…' : 'Commencer'}
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(async () => setResult(await confirmEnrollmentAction({}, data)))
      }}
      className="grid gap-4"
      noValidate
    >
      <input type="hidden" name="factorId" value={start.factorId} />
      <ErrorAlert message={result.error} />
      <ol className="grid list-decimal gap-3 pl-5 text-sm">
        <li>Ouvrez votre application d&apos;authentification (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).</li>
        <li>
          Scannez ce QR code, ou saisissez la clé :{' '}
          <code data-testid="totp-secret" className="bg-muted rounded px-1.5 py-0.5 font-mono break-all">
            {start.secret}
          </code>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR code en data URI */}
          <img src={start.qrCode} alt="QR code à scanner avec votre application d'authentification" width={192} height={192} className="mt-3 rounded border bg-white p-2" />
        </li>
        <li>Saisissez le code à 6 chiffres affiché par l&apos;application.</li>
      </ol>
      <CodeField state={result} label="Code à 6 chiffres" inputMode="numeric" />
      <Button type="submit" disabled={pending}>
        {pending ? 'Vérification…' : 'Activer le second facteur'}
      </Button>
    </form>
  )
}

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyTotpAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <ErrorAlert message={state.error} />
      <CodeField state={state} label="Code à 6 chiffres" inputMode="numeric" hint="Affiché par votre application d'authentification." />
      <Button type="submit" disabled={pending}>
        {pending ? 'Vérification…' : 'Valider'}
      </Button>
      <p className="text-sm">
        <Link href="/securite/secours" className="underline">
          Je n&apos;ai plus accès à mon application
        </Link>
      </p>
    </form>
  )
}

export function RecoveryForm() {
  const [state, action, pending] = useActionState(redeemRecoveryCodeAction, initial)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <ErrorAlert message={state.error} />
      <CodeField state={state} label="Code de secours" hint="Format : xxxx-xxxx-xxxx-xxxx. Il supprimera votre ancien second facteur : vous en activerez un nouveau ensuite." />
      <Button type="submit" disabled={pending}>
        {pending ? 'Vérification…' : 'Utiliser ce code'}
      </Button>
      <p className="text-sm">
        <Link href="/securite/verification" className="underline">
          Retour
        </Link>
      </p>
    </form>
  )
}

export function RegenerateCodes() {
  const [state, setState] = useState<MfaFormState>({})
  const [pending, startTransition] = useTransition()
  useEffect(() => () => setState({}), [])
  return (
    <div className="grid gap-4">
      <ErrorAlert message={state.error} />
      {state.recoveryCodes && <RecoveryCodes codes={state.recoveryCodes} />}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(async () => setState(await regenerateRecoveryCodesAction()))}
      >
        {pending ? 'Génération…' : 'Générer de nouveaux codes de secours'}
      </Button>
      <p className="text-muted-foreground text-sm">Les anciens codes cessent de fonctionner dès que de nouveaux sont générés.</p>
    </div>
  )
}
