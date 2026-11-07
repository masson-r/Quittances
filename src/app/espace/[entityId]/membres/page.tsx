import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireSection } from '@/domains/identity/entity-access'
import { listMembers, listPendingInvitations } from '@/domains/identity/members-service'
import { roleLabel, statusLabel } from '@/domains/identity/roles'
import { InviteForm, MemberActions, PendingInvitationActions } from './forms'

export const metadata: Metadata = { title: 'Membres — Loyo-reg' }

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' })

async function Members({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { user, entityName, permissions } = await requireSection(entityId, 'membres')
  const canWrite = permissions.includes('member:write')
  const [members, invitations] = await Promise.all([listMembers(entityId), listPendingInvitations(entityId)])

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Membres</h1>
        <p className="text-muted-foreground">{entityName}</p>
      </header>

      <section aria-labelledby="membres-titre" className="grid gap-3">
        <h2 id="membres-titre" className="text-lg font-semibold">
          Membres
        </h2>
        <ul className="grid gap-3">
          {members.map((m) => {
            const label = m.name || m.email
            return (
              <li key={m.id} className="grid gap-2 rounded-lg border p-3" data-testid="member">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {label}
                    {m.profileId === user.id && <span className="text-muted-foreground"> (vous)</span>}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {m.email} · {roleLabel(m.role)} · {statusLabel(m.status)}
                  </span>
                </div>
                {canWrite && <MemberActions entityId={entityId} membershipId={m.id} role={m.role} status={m.status} label={label} />}
              </li>
            )
          })}
        </ul>
      </section>

      {canWrite && (
        <>
          <section aria-labelledby="invitations-titre" className="grid gap-3">
            <h2 id="invitations-titre" className="text-lg font-semibold">
              Invitations en attente
            </h2>
            {invitations.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aucune invitation en attente.</p>
            ) : (
              <ul className="grid gap-3">
                {/* Clé = adresse : une invitation régénérée garde sa ligne, donc le nouveau lien reste affiché. */}
                {invitations.map((i) => (
                  <li key={i.email} className="grid gap-2 rounded-lg border p-3" data-testid="pending-invitation">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{i.email}</span>
                      <span className="text-muted-foreground text-sm">
                        {roleLabel(i.role)} · valable jusqu&apos;au {dateFormat.format(new Date(i.expiresAt))}
                      </span>
                    </div>
                    <PendingInvitationActions entityId={entityId} invitationId={i.id} email={i.email} role={i.role} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="inviter-titre" className="grid max-w-md gap-3">
            <h2 id="inviter-titre" className="text-lg font-semibold">
              Inviter un membre
            </h2>
            <InviteForm entityId={entityId} />
          </section>
        </>
      )}
    </div>
  )
}

export default function MembresPage({ params }: PageProps<'/espace/[entityId]/membres'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <Members params={params} />
    </Suspense>
  )
}
