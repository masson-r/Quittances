import { formatDateFr } from '@/lib/dates'
import { ACCESS_STATUS_LABELS, type AccessOverviewRow } from '@/domains/tenant-access/service'
import { DecideButtons, RevokeButton } from './forms'

/** Demandes et rattachements vus par le propriétaire : e-mail du compte et du dossier, avertissement en cas d'écart. */
export function AccessList({ entityId, rows, showTenant }: { entityId: string; rows: AccessOverviewRow[]; showTenant: boolean }) {
  if (rows.length === 0) return null
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-2 rounded-lg border p-3" data-testid="access-request">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{showTenant ? r.tenantName : r.accountEmail}</span>
            <span className="text-sm" data-testid="access-status">
              {ACCESS_STATUS_LABELS[r.status]}
            </span>
          </div>
          <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">E-mail du compte</dt>
            <dd>{r.accountEmail}</dd>
            <dt className="text-muted-foreground">E-mail du dossier</dt>
            <dd>{r.tenantEmail ?? '—'}</dd>
            <dt className="text-muted-foreground">Demande</dt>
            <dd>{formatDateFr(r.requestedAt.slice(0, 10))}</dd>
          </dl>
          {r.status === 'pending' && r.emailMismatch && (
            <p role="note" className="text-sm font-medium" data-testid="email-mismatch">
              Attention : l&apos;e-mail du compte diffère de celui du dossier. Vérifiez l&apos;identité du demandeur avant de valider.
            </p>
          )}
          {r.status === 'active' && r.consentWithdrawnAt !== null && (
            <p className="text-sm">Le locataire a retiré son consentement : remise papier demandée.</p>
          )}
          {r.status === 'pending' && <DecideButtons entityId={entityId} requestId={r.id} who={r.accountEmail} />}
          {r.status === 'active' && <RevokeButton entityId={entityId} requestId={r.id} who={r.accountEmail} />}
        </li>
      ))}
    </ul>
  )
}
