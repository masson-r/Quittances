import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listProperties } from '@/domains/properties/service'
import { buttonVariants } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Biens — Loyo-reg' }

async function PropertiesList({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'biens')
  const showArchived = (await searchParams).archives === '1'
  const properties = await listProperties(entityId, showArchived)

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Biens</h1>
          <p className="text-muted-foreground">{entityName}</p>
        </div>
        {permissions.includes('property:write') && (
          <Link href={`/espace/${entityId}/biens/nouveau`} className={buttonVariants()}>
            Nouveau bien
          </Link>
        )}
      </header>

      <p className="text-sm">
        <Link href={showArchived ? `/espace/${entityId}/biens` : `/espace/${entityId}/biens?archives=1`} className="underline">
          {showArchived ? 'Masquer les biens archivés' : 'Afficher aussi les biens archivés'}
        </Link>
      </p>

      {properties.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">Aucun bien pour le moment.</p>
      ) : (
        <ul className="grid gap-3">
          {properties.map((p) => (
            <li key={p.id} className="rounded-lg border p-3" data-testid="property">
              <Link href={`/espace/${entityId}/biens/${p.id}`} className="font-medium underline">
                {p.label}
              </Link>
              {p.archivedAt && <span className="text-muted-foreground ml-2 text-sm">(archivé)</span>}
              <p className="text-muted-foreground text-sm">
                {p.addressLine1}, {p.postalCode} {p.city}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BiensPage({ params, searchParams }: PageProps<'/espace/[entityId]/biens'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <PropertiesList params={params} searchParams={searchParams} />
    </Suspense>
  )
}
