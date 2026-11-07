import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireSection } from '@/domains/identity/entity-access'
import { getPrivateDetails, getTenant, tenantName } from '@/domains/tenants/service'
import { ArchiveTenantForm, PrivateDetailsForm, TenantForm } from '../forms'

export const metadata: Metadata = { title: 'Dossier locataire — Loyo-reg' }

async function TenantSheet({ params }: { params: Promise<{ entityId: string; tenantId: string }> }) {
  const { entityId, tenantId } = await params
  if (!z.uuid().safeParse(tenantId).success) notFound()
  const { permissions } = await requireSection(entityId, 'locataires')
  const tenant = await getTenant(entityId, tenantId)
  if (!tenant) notFound()

  const canWrite = permissions.includes('tenant:write')
  const canSeeSensitive = permissions.includes('sensitive:read')
  const canWriteSensitive = permissions.includes('sensitive:write')
  const details = canSeeSensitive ? await getPrivateDetails(tenantId) : null

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">
          {tenantName(tenant)}
          {tenant.archivedAt && <span className="text-muted-foreground ml-2 text-base font-normal">(archivé)</span>}
        </h1>
        <Link href={`/espace/${entityId}/locataires`} className="text-sm underline">
          Retour aux locataires
        </Link>
      </header>

      <section aria-labelledby="coordonnees" className="grid max-w-xl gap-3">
        <h2 id="coordonnees" className="text-lg font-semibold">
          Coordonnées
        </h2>
        {canWrite ? (
          <TenantForm entityId={entityId} tenant={tenant} />
        ) : (
          <dl className="grid gap-1 text-sm">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{tenant.email ?? '—'}</dd>
            <dt className="text-muted-foreground">Téléphone</dt>
            <dd>{tenant.phone ?? '—'}</dd>
            <dt className="text-muted-foreground">Adresse</dt>
            <dd>{[tenant.addressLine1, tenant.postalCode, tenant.city].filter(Boolean).join(' ') || '—'}</dd>
          </dl>
        )}
      </section>

      {canSeeSensitive && (
        <section aria-labelledby="sensibles" className="grid max-w-xl gap-3">
          <h2 id="sensibles" className="text-lg font-semibold">
            Informations sensibles
          </h2>
          <p className="text-muted-foreground text-sm">Réservées à l&apos;administrateur et au gestionnaire.</p>
          {canWriteSensitive ? (
            <PrivateDetailsForm entityId={entityId} tenantId={tenantId} details={details} />
          ) : (
            <p className="text-sm">Lecture seule.</p>
          )}
        </section>
      )}

      {canWrite && (
        <section aria-labelledby="archivage" className="grid max-w-xl gap-3">
          <h2 id="archivage" className="text-lg font-semibold">
            Archivage
          </h2>
          <ArchiveTenantForm entityId={entityId} tenantId={tenantId} archived={tenant.archivedAt !== null} />
        </section>
      )}
    </div>
  )
}

export default function LocataireDossierPage({ params }: PageProps<'/espace/[entityId]/locataires/[tenantId]'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <TenantSheet params={params} />
    </Suspense>
  )
}
