import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireSection } from '@/domains/identity/entity-access'
import { listLeasesForProperty } from '@/domains/leasing/service'
import { LEASE_STATUS_LABELS } from '@/domains/leasing/status'
import { getProperty, listAccessCodes, listNotes } from '@/domains/properties/service'
import { formatDateFr } from '@/lib/dates'
import { AccessCodeForm, ArchiveForm, DeleteCodeForm, NoteForm, PropertyForm } from '../forms'

export const metadata: Metadata = { title: 'Bien — Loyo-reg' }

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' })

async function PropertySheet({ params }: { params: Promise<{ entityId: string; propertyId: string }> }) {
  const { entityId, propertyId } = await params
  if (!z.uuid().safeParse(propertyId).success) notFound()
  const { permissions } = await requireSection(entityId, 'biens')
  const property = await getProperty(entityId, propertyId)
  if (!property) notFound()

  const canWrite = permissions.includes('property:write')
  const canSeeCodes = permissions.includes('sensitive:read')
  const canWriteCodes = permissions.includes('sensitive:write')
  const canSeeLeases = permissions.includes('lease:read')
  const [notes, codes, leases] = await Promise.all([
    listNotes(propertyId),
    canSeeCodes ? listAccessCodes(propertyId) : Promise.resolve([]),
    canSeeLeases ? listLeasesForProperty(entityId, propertyId) : Promise.resolve([]),
  ])

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">
          {property.label}
          {property.archivedAt && <span className="text-muted-foreground ml-2 text-base font-normal">(archivé)</span>}
        </h1>
        <p className="text-muted-foreground">
          {property.addressLine1}
          {property.addressLine2 ? `, ${property.addressLine2}` : ''}, {property.postalCode} {property.city}
        </p>
        <Link href={`/espace/${entityId}/biens`} className="text-sm underline">
          Retour aux biens
        </Link>
      </header>

      {canWrite ? (
        <section aria-labelledby="infos" className="grid max-w-xl gap-3">
          <h2 id="infos" className="text-lg font-semibold">
            Informations
          </h2>
          <PropertyForm entityId={entityId} property={property} />
        </section>
      ) : (
        property.description && (
          <section aria-labelledby="infos" className="grid gap-2">
            <h2 id="infos" className="text-lg font-semibold">
              Description
            </h2>
            <p className="text-sm whitespace-pre-line">{property.description}</p>
          </section>
        )
      )}

      {canSeeLeases && (
        <section aria-labelledby="occupations" className="grid max-w-xl gap-3">
          <h2 id="occupations" className="text-lg font-semibold">
            Historique des occupations
          </h2>
          {leases.length === 0 ? (
            <p className="text-muted-foreground text-sm">Ce bien n&apos;a encore jamais été loué.</p>
          ) : (
            <ul className="grid gap-2">
              {leases.map((l) => (
                <li key={l.id} className="rounded-lg border p-3 text-sm" data-testid="occupation">
                  <Link href={`/espace/${entityId}/baux/${l.id}`} className="font-medium underline">
                    {formatDateFr(l.startDate)} {l.endDate ? `→ ${formatDateFr(l.endDate)}` : '→ en cours'}
                  </Link>
                  <span className="text-muted-foreground"> · {LEASE_STATUS_LABELS[l.status]}</span>
                  <p>{l.allTenants.join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="notes" className="grid max-w-xl gap-3">
        <h2 id="notes" className="text-lg font-semibold">
          Notes de maintenance
        </h2>
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune note.</p>
        ) : (
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border p-3 text-sm" data-testid="note">
                <p className="text-muted-foreground">
                  {dateFormat.format(new Date(n.notedOn))}
                  {n.authorName && ` · ${n.authorName}`}
                </p>
                <p className="whitespace-pre-line">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canWrite && <NoteForm entityId={entityId} propertyId={propertyId} />}
      </section>

      {canSeeCodes && (
        <section aria-labelledby="codes" className="grid max-w-xl gap-3">
          <h2 id="codes" className="text-lg font-semibold">
            Codes d&apos;accès
          </h2>
          <p className="text-muted-foreground text-sm">Réservés à l&apos;administrateur et au gestionnaire.</p>
          {codes.map((c) => (
            <div key={c.id} className="grid gap-3 rounded-lg border p-3" data-testid="access-code">
              {canWriteCodes ? (
                <>
                  <AccessCodeForm entityId={entityId} propertyId={propertyId} code={c} />
                  <DeleteCodeForm entityId={entityId} propertyId={propertyId} code={c} />
                </>
              ) : (
                <p className="text-sm">
                  {c.label} : <strong>{c.code}</strong>
                  {c.note && ` — ${c.note}`}
                </p>
              )}
            </div>
          ))}
          {canWriteCodes && <AccessCodeForm entityId={entityId} propertyId={propertyId} />}
        </section>
      )}

      {canWrite && (
        <section aria-labelledby="archivage" className="grid max-w-xl gap-3">
          <h2 id="archivage" className="text-lg font-semibold">
            Archivage
          </h2>
          <ArchiveForm entityId={entityId} propertyId={propertyId} archived={property.archivedAt !== null} />
        </section>
      )}
    </div>
  )
}

export default function BienPage({ params }: PageProps<'/espace/[entityId]/biens/[propertyId]'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <PropertySheet params={params} />
    </Suspense>
  )
}
