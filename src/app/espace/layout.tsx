import { Suspense } from 'react'
import { requireUser } from '@/domains/identity/session'
import { signOutAction } from '@/domains/identity/auth-actions'
import { Button } from '@/components/ui/button'

async function UserBar() {
  const user = await requireUser()
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <span className="font-semibold">Loyo-reg</span>
      <div className="flex items-center gap-3 text-sm">
        <span data-testid="current-user">
          {user.firstName} {user.lastName}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Se déconnecter
          </Button>
        </form>
      </div>
    </header>
  )
}

export default function EspaceLayout({ children }: LayoutProps<'/espace'>) {
  return (
    <>
      <Suspense fallback={<div className="border-b px-4 py-3">Loyo-reg</div>}>
        <UserBar />
      </Suspense>
      {children}
    </>
  )
}
