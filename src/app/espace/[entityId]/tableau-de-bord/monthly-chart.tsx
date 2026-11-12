import { formatCents } from '@/lib/money'

interface Row {
  label: string
  calledCents: number
  collectedCents: number
  expensesCents: number
}

const W = 720
const H = 220
const PAD = { top: 12, right: 8, bottom: 28, left: 8 }

/**
 * Barres « encaissé » et « dépenses » par mois, ligne « appelé ». Rendu serveur en SVG, avec le tableau des valeurs
 * en alternative accessible (les couleurs ne portent pas seules l'information : légende et tableau en texte).
 */
export function MonthlyChart({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Aucune donnée.</p>
  const max = Math.max(1, ...rows.flatMap((r) => [r.calledCents, r.collectedCents, r.expensesCents]))
  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
  const slot = inner.w / rows.length
  const bar = Math.max(2, Math.min(18, slot / 3))
  const y = (v: number) => PAD.top + inner.h - (v / max) * inner.h
  const line = rows.map((r, i) => `${PAD.left + slot * i + slot / 2},${y(r.calledCents)}`).join(' ')
  const step = Math.ceil(rows.length / 12)

  return (
    <figure className="grid gap-3" data-testid="monthly-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution mensuelle : encaissé, dépenses et loyers appelés" className="h-auto w-full">
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + inner.h} y2={PAD.top + inner.h} stroke="currentColor" strokeOpacity="0.3" />
        {rows.map((r, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={r.label}>
              <rect x={cx - bar - 1} y={y(r.collectedCents)} width={bar} height={PAD.top + inner.h - y(r.collectedCents)} fill="#2b6cb0" />
              <rect x={cx + 1} y={y(r.expensesCents)} width={bar} height={PAD.top + inner.h - y(r.expensesCents)} fill="#c05621" />
              {i % step === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor">
                  {r.label}
                </text>
              )}
            </g>
          )
        })}
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block size-3 align-middle" style={{ background: '#2b6cb0' }} />
          Encaissé
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block size-3 align-middle" style={{ background: '#c05621' }} />
          Dépenses
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block w-4 border-t-2 border-dashed align-middle" />
          Loyers appelés
        </span>
      </figcaption>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer underline">Voir les valeurs</summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Valeurs mensuelles (défilement horizontal)">
          <table className="w-full min-w-[28rem]">
            <caption className="sr-only">Valeurs mensuelles</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 pr-3 font-medium">Mois</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Appelé</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Encaissé</th>
                <th scope="col" className="py-1 text-right font-medium">Dépenses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{r.label}</th>
                  <td className="py-1 pr-3 text-right">{formatCents(r.calledCents)}</td>
                  <td className="py-1 pr-3 text-right">{formatCents(r.collectedCents)}</td>
                  <td className="py-1 text-right">{formatCents(r.expensesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
