// Fixtures fictives pour la reprise d'historique : trois baux sur cinq ans, aujourd'hui = 15 mars 2026.
// Bail A : en cours depuis mars 2021, loyer révisé en mars 2023, deux mois impayés (janvier et février 2026).
// Bail B : du 1er septembre 2021 au 31 août 2024, un mois payé à moitié (mai 2023), apurement final.
// Bail C : en cours depuis janvier 2024, deux colocataires, dont un qui quitte le bail commun en cours de route.

export interface Fixture {
  payload: Record<string, unknown[]>
  /** Totaux attendus, calculés ici indépendamment de la base. */
  expected: {
    charges: number
    payments: number
    calledByLeaseYear: Record<string, number>
    collectedByLeaseYear: Record<string, number>
    unpaid: { lease: string; period: string; balance: number }[]
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const months = (from: [number, number], to: [number, number]): [number, number][] => {
  const out: [number, number][] = []
  let [y, m] = from
  while (y < to[0] || (y === to[0] && m <= to[1])) {
    out.push([y, m])
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export function buildFixture(): Fixture {
  let line = 2
  const next = () => line++
  const payload: Record<string, Record<string, unknown>[]> = {
    properties: [
      { line: 2, ref: 'BIEN-A', label: 'Appartement A', address_line1: '1 rue des Lilas', postal_code: '75001', city: 'Paris' },
      { line: 3, ref: 'BIEN-B', label: 'Appartement B', address_line1: '2 rue des Tilleuls', postal_code: '75002', city: 'Paris' },
      { line: 4, ref: 'BIEN-C', label: 'Appartement C', address_line1: '3 rue des Ormes', postal_code: '75003', city: 'Paris' },
    ],
    tenants: [
      { line: 2, ref: 'LOC-1', last_name: 'Durand', first_name: 'Alice' },
      { line: 3, ref: 'LOC-2', last_name: 'Martin', first_name: 'Bob' },
      { line: 4, ref: 'LOC-3', last_name: 'Petit', first_name: 'Chloé' },
      { line: 5, ref: 'LOC-4', last_name: 'Roux', first_name: 'David' },
    ],
    leases: [
      {
        line: 2, ref: 'BAIL-A', property_ref: 'BIEN-A', start_date: '2021-03-01', end_date: null, due_day: 5,
        terms: [{ effective_from: '2021-03-01', rent_cents: 60000, charges_cents: 5000 }, { effective_from: '2023-03-01', rent_cents: 64000, charges_cents: 6000 }],
        tenants: [{ tenant_ref: 'LOC-1' }],
      },
      {
        line: 3, ref: 'BAIL-B', property_ref: 'BIEN-B', start_date: '2021-09-01', end_date: '2024-08-31', due_day: 1,
        terms: [{ effective_from: '2021-09-01', rent_cents: 50000, charges_cents: 4000 }],
        tenants: [{ tenant_ref: 'LOC-2' }],
      },
      {
        line: 4, ref: 'BAIL-C', property_ref: 'BIEN-C', start_date: '2024-01-01', end_date: null, due_day: 10,
        terms: [{ effective_from: '2024-01-01', rent_cents: 80000, charges_cents: 7000 }],
        tenants: [{ tenant_ref: 'LOC-3' }, { tenant_ref: 'LOC-4', end_date: null }],
      },
    ],
    charges: [],
    payments: [],
    expenses: [],
    settlements: [],
  }

  const called: Record<string, number> = {}
  const collected: Record<string, number> = {}
  const unpaid: Fixture['expected']['unpaid'] = []
  let charges = 0
  let payments = 0

  const rentOf = (lease: string, y: number, m: number): number => {
    if (lease === 'BAIL-A') return y > 2023 || (y === 2023 && m >= 3) ? 70000 : 65000
    if (lease === 'BAIL-B') return 54000
    return 87000
  }
  const dueDay = (lease: string) => (lease === 'BAIL-A' ? 5 : lease === 'BAIL-B' ? 1 : 10)
  const plans: [string, [number, number], [number, number]][] = [
    ['BAIL-A', [2021, 3], [2026, 3]],
    ['BAIL-B', [2021, 9], [2024, 8]],
    ['BAIL-C', [2024, 1], [2026, 3]],
  ]

  for (const [lease, from, to] of plans) {
    for (const [y, m] of months(from, to)) {
      const total = rentOf(lease, y, m)
      const due = `${y}-${pad(m)}-${pad(dueDay(lease))}`
      // Échéance future dans le mois courant : l'import ne crée que les échéances échues (le 10 mars est échu).
      if (due > '2026-03-15') continue
      charges++
      const key = `${lease}:${y}`
      called[key] = (called[key] ?? 0) + total

      let paidAmount = total
      let paidOn = `${y}-${pad(m)}-${pad(Math.min(dueDay(lease), 28))}`
      if (lease === 'BAIL-A' && y === 2026 && m <= 2) {
        unpaid.push({ lease, period: `${y}-${pad(m)}`, balance: total })
        continue
      }
      if (lease === 'BAIL-A' && y === 2026 && m === 3) {
        // Mars 2026 : payé en retard (ni impayé ni en avance).
        paidOn = '2026-03-12'
      }
      if (lease === 'BAIL-B' && y === 2023 && m === 5) {
        paidAmount = total / 2
        unpaid.push({ lease, period: `${y}-${pad(m)}`, balance: total - paidAmount })
      }
      payments++
      collected[`${lease}:${y}`] = (collected[`${lease}:${y}`] ?? 0) + paidAmount
      payload.payments.push({
        line: next(),
        ref: `PAI-${lease}-${y}-${pad(m)}`,
        lease_ref: lease,
        amount_cents: paidAmount,
        received_on: paidOn,
        mode: m % 3 === 0 ? 'cheque' : 'transfer',
        reference: `VIR${y}${pad(m)}`,
        // Affectation par période, sauf un paiement laissé à l'affectation automatique (le plus ancien impayé).
        period_start: lease === 'BAIL-C' && y === 2024 && m === 1 ? undefined : `${y}-${pad(m)}-01`,
      })
    }
  }

  payload.expenses.push(
    { line: 2, ref: 'DEP-1', property_ref: 'BIEN-A', category: 'Travaux', expense_date: '2022-06-15', description: 'Peinture', amount_cents: 120000 },
    { line: 3, ref: 'DEP-2', property_ref: 'BIEN-B', category: 'assurance', expense_date: '2023-01-10', description: 'Assurance annuelle', amount_cents: 30000, recoverable: false },
    { line: 4, ref: 'DEP-3', property_ref: 'BIEN-C', category: 'Taxe foncière', expense_date: '2025-10-01', description: 'Taxe foncière 2025', amount_cents: 95000 },
  )
  payload.settlements.push({
    line: 2, ref: 'APU-B-FINAL', lease_ref: 'BAIL-B', settled_on: '2024-09-15', amount_cents: 12000, mode: 'transfer', reason: 'Régularisation des charges', is_final: true,
  })

  return { payload, expected: { charges, payments, calledByLeaseYear: called, collectedByLeaseYear: collected, unpaid } }
}
