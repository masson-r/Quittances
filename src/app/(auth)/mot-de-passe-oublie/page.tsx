import type { Metadata } from 'next'
import Link from 'next/link'
import { ForgotPasswordForm } from '../forms'

export const metadata: Metadata = { title: 'Mot de passe oublié — Loyo-reg' }

export default function MotDePasseOubliePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Mot de passe oublié</h1>
      <p className="text-muted-foreground text-sm">Saisissez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
      <p className="text-sm">
        <Link href="/connexion" className="underline">
          Retour à la connexion
        </Link>
      </p>
    </>
  )
}
