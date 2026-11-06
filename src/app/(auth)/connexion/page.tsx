import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { safeNextPath } from '@/lib/safe-redirect'
import { SignInForm } from '../forms'

export const metadata: Metadata = { title: 'Connexion — Loyo-reg' }

const NOTICES: Record<string, string> = {
  desactive: "Votre accès a été désactivé. Contactez l'administrateur de votre structure.",
  lien: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.',
}

async function SignInSection({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const notice = NOTICES[first(params.erreur) ?? '']
  return (
    <>
      {notice && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <SignInForm next={safeNextPath(first(params.next))} />
    </>
  )
}

export default function ConnexionPage({ searchParams }: PageProps<'/connexion'>) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <SignInSection searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        Pas encore de compte ?{' '}
        <Link href="/inscription" className="underline">
          Créer un compte
        </Link>
      </p>
    </>
  )
}
