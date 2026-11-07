import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { EntityNav } from '@/components/app-shell/entity-nav'
import { listMyMemberships, myPermissions } from '@/domains/identity/members-service'
import { visibleNav } from '@/domains/identity/navigation'
import { requireUser } from '@/domains/identity/session'

async function EntityShell({ params, children }: { params: Promise<{ entityId: string }>; children: React.ReactNode }) {
  const { entityId } = await params
  if (!z.uuid().safeParse(entityId).success) notFound()

  const user = await requireUser()
  const [permissions, memberships] = await Promise.all([myPermissions(entityId), listMyMemberships(user.id)])
  if (!permissions.includes('structure:read')) notFound()

  const entities = memberships.map((m) => ({ id: m.entityId, name: m.entityName }))
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4 md:flex-row md:gap-8 md:py-8">
      <aside className="md:w-60 md:shrink-0">
        <EntityNav entityId={entityId} entities={entities} items={visibleNav(permissions)} />
      </aside>
      <main id="contenu" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  )
}

export default function EntityLayout({ children, params }: LayoutProps<'/espace/[entityId]'>) {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-6xl px-4 py-8">Chargement…</div>}>
      <EntityShell params={params}>{children}</EntityShell>
    </Suspense>
  )
}
