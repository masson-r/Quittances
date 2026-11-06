import type { Metadata } from 'next'
import { NewPasswordForm } from '../../forms'

export const metadata: Metadata = { title: 'Nouveau mot de passe — Loyo-reg' }

export default function NouveauMotDePassePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>
      <NewPasswordForm />
    </>
  )
}
