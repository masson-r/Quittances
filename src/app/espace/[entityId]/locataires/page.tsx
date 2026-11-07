import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listTenants, tenantName } from '@/domains/tenants/service'
import { buttonVariants } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Locataires — Loyo-reg' }

async function TenantsList({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'locataires')
  const showArchived = (await searchParams).archives === '1'
  const tenants = await listTenants(entityId, showArchived)

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Locataires</h1>
          <p className="text-muted-foreground">{entityName}</p>
        </div>
        {permissions.includes('tenant:write') && (
          <Link href={`/espace/${entityId}/locataires/nouveau`} className={buttonVariants()}>
            Nouveau dossier
          </Link>
        )}
      </header>

      <p className="text-sm">
        <Link href={showArchived ? `/espace/${entityId}/locataires` : `/espace/${entityId}/locataires?archives=1`} className="underline">
          {showArchived ? 'Masquer les dossiers archivés' : 'Afficher aussi les dossiers archivés'}
        </Link>
      </p>

      {tenants.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">Aucun dossier pour le moment.</p>
      ) : (
        <ul className="grid gap-3">
          {tenants.map((t) => (
            <li key={t.id} className="rounded-lg border p-3" data-testid="tenant">
              <Link href={`/espace/${entityId}/locataires/${t.id}`} className="font-medium underline">
                {tenantName(t)}
              </Link>
              {t.archivedAt && <span className="text-muted-foreground ml-2 text-sm">(archivé)</span>}
              {(t.email || t.phone) && <p className="text-muted-foreground text-sm">{[t.email, t.phone].filter(Boolean).join(' · ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function LocatairesPage({ params, searchParams }: PageProps<'/espace/[entityId]/locataires'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <TenantsList params={params} searchParams={searchParams} />
    </Suspense>
  )
}
