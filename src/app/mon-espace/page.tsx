import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@/domains/identity/session'
import { formatCents } from '@/lib/money'
import { formatDateFr } from '@/lib/dates'
import { ACCESS_STATUS_LABELS, listMyDossiers, listMyLeases, listMyRequests } from '@/domains/tenant-access/service'
import { ContactForm, DetachButton, WithdrawConsentButton } from '@/components/tenant-access/forms'

export const metadata: Metadata = { title: 'Mon espace locataire — Loyo-reg' }

async function TenantSpace() {
  const user = await requireUser()
  const [requests, dossiers, leases] = await Promise.all([listMyRequests(), listMyDossiers(), listMyLeases()])

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Mon espace locataire</h1>
        <p className="text-muted-foreground text-sm">Connecté avec {user.email}</p>
        <Link href="/espace" className="text-sm underline">
          Espace propriétaire
        </Link>
      </header>

      <section aria-labelledby="demandes" className="grid gap-3">
        <h2 id="demandes" className="text-lg font-semibold">
          Mes demandes d&apos;accès
        </h2>
        {requests.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            Aucune demande. Utilisez le lien que votre propriétaire vous a transmis pour demander l&apos;accès à vos quittances.
          </p>
        ) : (
          <ul className="grid gap-3">
            {requests.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-lg border p-3" data-testid="my-request">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.entityName}</span>
                  <span className="text-sm" data-testid="request-status">
                    {ACCESS_STATUS_LABELS[r.status]}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">Demande du {formatDateFr(r.requestedAt.slice(0, 10))}</p>
                {r.status === 'active' && (
                  <div className="flex flex-wrap gap-2">
                    {r.consentWithdrawnAt === null && <WithdrawConsentButton requestId={r.id} entityName={r.entityName} />}
                    <DetachButton requestId={r.id} entityName={r.entityName} />
                  </div>
                )}
                {r.status === 'active' && r.consentWithdrawnAt !== null && (
                  <p className="text-sm">Consentement retiré : vos quittances vous sont remises sur papier.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dossiers.map((d) => (
        <section key={d.accessId} aria-labelledby={`dossier-${d.tenantId}`} className="grid gap-6" data-testid="my-dossier">
          <div className="grid gap-1">
            <h2 id={`dossier-${d.tenantId}`} className="text-lg font-semibold">
              {d.firstName} {d.lastName} — {d.entityName}
            </h2>
            <p className="text-muted-foreground text-sm">E-mail du dossier : {d.email ?? '—'} (modifiable par votre propriétaire seulement)</p>
          </div>
          <ContactForm dossier={d} />
          <div className="grid gap-2">
            <h3 className="font-medium">Mes baux</h3>
            <ul className="grid gap-2">
              {leases
                .filter((l) => l.tenantId === d.tenantId)
                .map((l) => (
                  <li key={l.leaseId} className="rounded-lg border p-3 text-sm" data-testid="my-lease">
                    <p className="font-medium">{l.propertyLabel}</p>
                    <p className="text-muted-foreground">{l.address}</p>
                    <p>
                      Du {formatDateFr(l.startDate)} {l.endDate ? `au ${formatDateFr(l.endDate)}` : '(en cours)'}
                    </p>
                    {l.rentCents !== null && l.chargesCents !== null && (
                      <p>
                        Loyer {formatCents(l.rentCents)} + charges {formatCents(l.chargesCents)}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  )
}

export default function MonEspacePage() {
  return (
    <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<p>Chargement…</p>}>
        <TenantSpace />
      </Suspense>
    </main>
  )
}
