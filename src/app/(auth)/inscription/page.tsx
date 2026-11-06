import type { Metadata } from 'next'
import Link from 'next/link'
import { SignUpForm } from '../forms'

export const metadata: Metadata = { title: 'Créer un compte — Loyo-reg' }

export default function InscriptionPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Créer un compte</h1>
      <p className="text-muted-foreground text-sm">
        Le compte ne donne accès à aucune structure tant qu&apos;un administrateur ne vous a pas invité.
      </p>
      <SignUpForm />
      <p className="text-sm">
        Déjà un compte ?{' '}
        <Link href="/connexion" className="underline">
          Se connecter
        </Link>
      </p>
    </>
  )
}
