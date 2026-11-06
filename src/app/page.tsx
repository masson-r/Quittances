import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">Loyo-reg</h1>
      <p className="text-muted-foreground">Gestion locative : biens, baux, loyers, encaissements et quittances.</p>
      <div className="flex gap-3">
        <Link href="/connexion" className={buttonVariants()}>
          Se connecter
        </Link>
        <Link href="/inscription" className={buttonVariants({ variant: 'outline' })}>
          Créer un compte
        </Link>
      </div>
    </main>
  )
}
