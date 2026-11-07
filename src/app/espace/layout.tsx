import { Suspense } from 'react'
import Link from 'next/link'
import { requireUser } from '@/domains/identity/session'
import { signOutAction } from '@/domains/identity/auth-actions'
import { Button } from '@/components/ui/button'

async function UserBar() {
  const user = await requireUser()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span data-testid="current-user">
        {user.firstName} {user.lastName}
      </span>
      <Link href="/securite" className="underline">
        Sécurité
      </Link>
      <form action={signOutAction}>
        <Button type="submit" variant="outline" size="sm">
          Se déconnecter
        </Button>
      </form>
    </div>
  )
}

export default function EspaceLayout({ children }: LayoutProps<'/espace'>) {
  return (
    <>
      <a
        href="#contenu"
        className="bg-background focus:ring-ring sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:ring-2"
      >
        Aller au contenu
      </a>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-4 py-3">
        <Link href="/espace" className="font-semibold">
          Loyo-reg
        </Link>
        <Suspense fallback={<span aria-hidden="true" />}>
          <UserBar />
        </Suspense>
      </header>
      {children}
    </>
  )
}
