import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  CASH_WARNING_CENTS,
  chargeAmounts,
  computeStatus,
  daysInMonth,
  dueDateFor,
  needsCashWarning,
  occupiedDays,
  periodsDue,
  proposeAllocation,
  prorata,
  termForPeriod,
} from './rules'

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2100, 2, 28],
    [2000, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i a %i jours', (y, m, d) => expect(daysInMonth(y, m)).toBe(d))
})

describe('dueDateFor', () => {
  const open = { start: '2020-01-01', end: null }

  it('prend le jour d\'échéance du bail dans le mois', () => {
    expect(dueDateFor({ year: 2026, month: 3 }, 5, open.start, open.end)).toBe('2026-03-05')
  })

  it('ramène les jours 29 à 31 au dernier jour du mois', () => {
    expect(dueDateFor({ year: 2026, month: 2 }, 31, open.start, open.end)).toBe('2026-02-28')
    expect(dueDateFor({ year: 2024, month: 2 }, 30, open.start, open.end)).toBe('2024-02-29')
    expect(dueDateFor({ year: 2026, month: 4 }, 31, open.start, open.end)).toBe('2026-04-30')
    expect(dueDateFor({ year: 2026, month: 1 }, 31, open.start, open.end)).toBe('2026-01-31')
  })

  it('première échéance à la date de début quand le jour d\'échéance la précède', () => {
    expect(dueDateFor({ year: 2026, month: 3 }, 5, '2026-03-12', null)).toBe('2026-03-12')
  })

  it('garde le jour d\'échéance quand il suit la date de début', () => {
    expect(dueDateFor({ year: 2026, month: 3 }, 20, '2026-03-12', null)).toBe('2026-03-20')
  })

  it('dernière échéance à la date de fin quand le jour d\'échéance la dépasse', () => {
    expect(dueDateFor({ year: 2026, month: 6 }, 28, '2025-01-01', '2026-06-10')).toBe('2026-06-10')
  })

  it('garde le jour d\'échéance quand il précède la date de fin', () => {
    expect(dueDateFor({ year: 2026, month: 6 }, 5, '2025-01-01', '2026-06-10')).toBe('2026-06-05')
  })

  it("refuse un jour d'échéance invalide", () => {
    for (const day of [0, 32, 1.5, -3]) expect(() => dueDateFor({ year: 2026, month: 3 }, day, '2026-01-01', null)).toThrow(RangeError)
  })

  it('bail commencé et terminé le même mois', () => {
    expect(dueDateFor({ year: 2026, month: 6 }, 1, '2026-06-10', '2026-06-20')).toBe('2026-06-10')
    expect(dueDateFor({ year: 2026, month: 6 }, 28, '2026-06-10', '2026-06-20')).toBe('2026-06-20')
  })
})

describe('occupiedDays', () => {
  it('mois entier', () => {
    expect(occupiedDays({ year: 2026, month: 3 }, '2025-01-01', null)).toBe(31)
    expect(occupiedDays({ year: 2026, month: 3 }, '2025-01-01', '2026-12-31')).toBe(31)
  })
  it('entrée en cours de mois : jours de la date de début à la fin du mois, inclus', () => {
    expect(occupiedDays({ year: 2026, month: 3 }, '2026-03-12', null)).toBe(20)
    expect(occupiedDays({ year: 2026, month: 3 }, '2026-03-01', null)).toBe(31)
  })
  it('sortie en cours de mois : du premier jour à la date de fin, incluse', () => {
    expect(occupiedDays({ year: 2026, month: 6 }, '2025-01-01', '2026-06-10')).toBe(10)
    expect(occupiedDays({ year: 2026, month: 6 }, '2025-01-01', '2026-06-30')).toBe(30)
  })
  it('entrée et sortie le même mois', () => {
    expect(occupiedDays({ year: 2026, month: 6 }, '2026-06-10', '2026-06-20')).toBe(11)
  })
  it('zéro hors de la période d\'occupation', () => {
    expect(occupiedDays({ year: 2026, month: 2 }, '2026-03-01', null)).toBe(0)
    expect(occupiedDays({ year: 2026, month: 8 }, '2025-01-01', '2026-07-31')).toBe(0)
  })
})

describe('prorata', () => {
  it('mois entier : le montant mensuel exact', () => {
    expect(prorata(85000, 31, 31)).toBe(85000)
  })
  it('arrondit au centime le plus proche', () => {
    expect(prorata(85000, 10, 31)).toBe(27419) // 27419,35
    expect(prorata(85000, 20, 31)).toBe(54839) // 54838,71
  })
  it('arrondit la moitié vers le haut', () => {
    expect(prorata(14, 1, 28)).toBe(1) // 0,5
    expect(prorata(10, 3, 30)).toBe(1)
    expect(prorata(1, 15, 30)).toBe(1) // 0,5
    expect(prorata(1, 14, 30)).toBe(0)
  })
  it('zéro jour : zéro', () => {
    expect(prorata(85000, 0, 30)).toBe(0)
  })
  it('refuse des paramètres incohérents', () => {
    expect(() => prorata(-1, 1, 30)).toThrow()
    expect(() => prorata(100.5, 1, 30)).toThrow()
    expect(() => prorata(100, 31, 30)).toThrow()
    expect(() => prorata(100, -1, 30)).toThrow()
    expect(() => prorata(100, 1, 0)).toThrow()
  })

  it('propriété : entre 0 et le montant mensuel, à un demi-centime de la valeur exacte', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 28, max: 31 }), fc.integer({ min: 0, max: 31 }), (monthly, dim, occ) => {
        fc.pre(occ <= dim)
        const value = prorata(monthly, occ, dim)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(monthly)
        expect(Math.abs(value - (monthly * occ) / dim)).toBeLessThanOrEqual(0.5 + 1e-9)
      }),
    )
  })

  it('propriété : croissant avec les jours occupés', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 28, max: 31 }), fc.integer({ min: 0, max: 30 }), (monthly, dim, occ) => {
        fc.pre(occ + 1 <= dim)
        expect(prorata(monthly, occ + 1, dim)).toBeGreaterThanOrEqual(prorata(monthly, occ, dim))
      }),
    )
  })
})

describe('chargeAmounts', () => {
  it('arrondit le loyer et les charges séparément, le total est leur somme', () => {
    const r = chargeAmounts(85000, 5000, 10, 31)
    expect(r).toEqual({ rentCents: 27419, chargesCents: 1613, totalCents: 29032 })
  })
  it('mois entier : montants exacts', () => {
    expect(chargeAmounts(85000, 5000, 30, 30)).toEqual({ rentCents: 85000, chargesCents: 5000, totalCents: 90000 })
  })
  it('propriété : total = loyer + charges', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 500_000 }), fc.integer({ min: 28, max: 31 }), fc.integer({ min: 0, max: 31 }), (rent, charges, dim, occ) => {
        fc.pre(occ <= dim)
        const r = chargeAmounts(rent, charges, occ, dim)
        expect(r.totalCents).toBe(r.rentCents + r.chargesCents)
      }),
    )
  })
})

describe('termForPeriod', () => {
  const terms = [
    { effectiveFrom: '2025-03-10', rentCents: 80000, chargesCents: 4000 },
    { effectiveFrom: '2026-01-01', rentCents: 82000, chargesCents: 4200 },
    { effectiveFrom: '2026-07-15', rentCents: 85000, chargesCents: 4500 },
  ]
  it('première période : version dont la date d\'effet est la date de début du bail', () => {
    expect(termForPeriod(terms, { year: 2025, month: 3 }, '2025-03-10')?.rentCents).toBe(80000)
  })
  it('une version s\'applique à la première période qui commence à sa date d\'effet ou après', () => {
    expect(termForPeriod(terms, { year: 2026, month: 1 }, '2025-03-10')?.rentCents).toBe(82000)
    expect(termForPeriod(terms, { year: 2026, month: 7 }, '2025-03-10')?.rentCents).toBe(82000) // 15 juillet : pas de découpage
    expect(termForPeriod(terms, { year: 2026, month: 8 }, '2025-03-10')?.rentCents).toBe(85000)
  })
  it('ne dépend pas de l\'ordre de la liste', () => {
    expect(termForPeriod([...terms].reverse(), { year: 2026, month: 8 }, '2025-03-10')?.rentCents).toBe(85000)
  })
  it('aucune version applicable avant la première date d\'effet', () => {
    expect(termForPeriod(terms, { year: 2025, month: 2 }, '2025-01-01')).toBeUndefined()
  })
  it('liste vide', () => {
    expect(termForPeriod([], { year: 2026, month: 1 }, '2025-01-01')).toBeUndefined()
  })
})

describe('computeStatus', () => {
  const base = { totalCents: 90000, dueDate: '2026-03-05' }
  it('à payer : aucun paiement, date non dépassée (jour d\'échéance inclus)', () => {
    expect(computeStatus({ ...base, allocatedCents: 0, today: '2026-03-04' })).toBe('to_pay')
    expect(computeStatus({ ...base, allocatedCents: 0, today: '2026-03-05' })).toBe('to_pay')
  })
  it('partiellement payée : paiement affecté, solde positif, date non dépassée', () => {
    expect(computeStatus({ ...base, allocatedCents: 1, today: '2026-03-05' })).toBe('partially_paid')
  })
  it('payée : solde nul, quelle que soit la date', () => {
    expect(computeStatus({ ...base, allocatedCents: 90000, today: '2026-03-04' })).toBe('paid')
    expect(computeStatus({ ...base, allocatedCents: 90000, today: '2027-01-01' })).toBe('paid')
  })
  it('en retard dès le lendemain de la date d\'échéance, prioritaire sur partiellement payée', () => {
    expect(computeStatus({ ...base, allocatedCents: 0, today: '2026-03-06' })).toBe('late')
    expect(computeStatus({ ...base, allocatedCents: 45000, today: '2026-03-06' })).toBe('late')
  })
  it('échéance de zéro euro : payée', () => {
    expect(computeStatus({ totalCents: 0, allocatedCents: 0, dueDate: '2026-03-05', today: '2026-04-01' })).toBe('paid')
  })
  it('refuse une affectation supérieure au total', () => {
    expect(() => computeStatus({ ...base, allocatedCents: 90001, today: '2026-03-05' })).toThrow()
    expect(() => computeStatus({ ...base, allocatedCents: -1, today: '2026-03-05' })).toThrow()
  })
})

describe('periodsDue', () => {
  it('rattrape toutes les échéances atteintes pour un bail commencé dans le passé', () => {
    const list = periodsDue({ start: '2026-01-15', end: null, dueDay: 5, today: '2026-04-10' })
    expect(list.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(list[0]).toMatchObject({ dueDate: '2026-01-15', occupiedDays: 17, daysInMonth: 31 })
    expect(list[1]).toMatchObject({ dueDate: '2026-02-05', occupiedDays: 28, daysInMonth: 28 })
  })
  it('exclut une échéance dont la date n\'est pas encore atteinte (pas de génération à l\'avance)', () => {
    const list = periodsDue({ start: '2026-01-01', end: null, dueDay: 20, today: '2026-04-10' })
    expect(list.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
  })
  it('inclut l\'échéance le jour même de sa date', () => {
    expect(periodsDue({ start: '2026-01-01', end: null, dueDay: 10, today: '2026-04-10' }).map((p) => p.key)).toContain('2026-04')
  })
  it('s\'arrête au mois de la date de fin, dernière échéance à cette date', () => {
    const list = periodsDue({ start: '2026-01-01', end: '2026-03-10', dueDay: 28, today: '2027-01-01' })
    expect(list.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(list[2]).toMatchObject({ dueDate: '2026-03-10', occupiedDays: 10 })
  })
  it('bail qui n\'a pas commencé : aucune échéance', () => {
    expect(periodsDue({ start: '2026-08-01', end: null, dueDay: 5, today: '2026-04-10' })).toEqual([])
  })
  it('bail commençant dans le mois mais avant la date : aucune échéance tant que la date de début n\'est pas atteinte', () => {
    expect(periodsDue({ start: '2026-04-20', end: null, dueDay: 5, today: '2026-04-10' })).toEqual([])
  })
  it('clés uniques et ordonnées, échéances croissantes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 31 }), fc.integer({ min: 0, max: 40 }), (dueDay, months) => {
        const start = '2024-01-31'
        const today = new Date(Date.UTC(2024, months, 15)).toISOString().slice(0, 10)
        const list = periodsDue({ start, end: null, dueDay, today })
        const keys = list.map((p) => p.key)
        expect(new Set(keys).size).toBe(keys.length)
        expect([...keys].sort()).toEqual(keys)
        for (const p of list) expect(p.dueDate <= today).toBe(true)
        const dues = list.map((p) => p.dueDate)
        expect([...dues].sort()).toEqual(dues)
      }),
    )
  })
})

describe('proposeAllocation', () => {
  const open = [
    { id: 'c3', dueDate: '2026-03-05', balanceCents: 90000 },
    { id: 'c1', dueDate: '2026-01-05', balanceCents: 90000 },
    { id: 'c2', dueDate: '2026-02-05', balanceCents: 30000 },
  ]
  it('affecte de la plus ancienne à la plus récente échéance', () => {
    const r = proposeAllocation(100000, open)
    expect(r.allocations).toEqual([
      { chargeId: 'c1', amountCents: 90000 },
      { chargeId: 'c2', amountCents: 10000 },
    ])
    expect(r.unallocatedCents).toBe(0)
  })
  it('le reste demeure non affecté, jamais au-delà du solde', () => {
    const r = proposeAllocation(500000, open)
    expect(r.allocations.map((a) => a.amountCents)).toEqual([90000, 30000, 90000])
    expect(r.unallocatedCents).toBe(290000)
  })
  it('à dates égales, ordre stable par identifiant', () => {
    const r = proposeAllocation(100, [
      { id: 'b', dueDate: '2026-01-05', balanceCents: 60 },
      { id: 'a', dueDate: '2026-01-05', balanceCents: 60 },
    ])
    expect(r.allocations).toEqual([
      { chargeId: 'a', amountCents: 60 },
      { chargeId: 'b', amountCents: 40 },
    ])
  })
  it('ignore les échéances soldées', () => {
    const r = proposeAllocation(50, [{ id: 'x', dueDate: '2026-01-05', balanceCents: 0 }])
    expect(r).toEqual({ allocations: [], unallocatedCents: 50 })
  })
  it('paiement en avance sans échéance : tout reste non affecté', () => {
    expect(proposeAllocation(85000, [])).toEqual({ allocations: [], unallocatedCents: 85000 })
  })
  it('refuse un paiement nul ou négatif', () => {
    expect(() => proposeAllocation(0, open)).toThrow()
    expect(() => proposeAllocation(-5, open)).toThrow()
  })
  it('propriété : la somme proposée plus le reste égale le paiement, chaque part respecte le solde', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.record({ id: fc.uuid(), dueDate: fc.constantFrom('2026-01-05', '2026-02-05', '2026-03-05'), balanceCents: fc.integer({ min: 0, max: 200_000 }) }), { maxLength: 8 }),
        (payment, charges) => {
          const r = proposeAllocation(payment, charges)
          const sum = r.allocations.reduce((acc, a) => acc + a.amountCents, 0)
          expect(sum + r.unallocatedCents).toBe(payment)
          for (const a of r.allocations) {
            const charge = charges.find((c) => c.id === a.chargeId)!
            expect(a.amountCents).toBeGreaterThan(0)
            expect(a.amountCents).toBeLessThanOrEqual(charge.balanceCents)
          }
        },
      ),
    )
  })
})

describe('needsCashWarning', () => {
  it('avertit à partir de 1 000 € en espèces seulement', () => {
    expect(CASH_WARNING_CENTS).toBe(100000)
    expect(needsCashWarning('cash', 99999)).toBe(false)
    expect(needsCashWarning('cash', 100000)).toBe(true)
    expect(needsCashWarning('cash', 250000)).toBe(true)
    expect(needsCashWarning('transfer', 250000)).toBe(false)
    expect(needsCashWarning('cheque', 250000)).toBe(false)
    expect(needsCashWarning('other', 250000)).toBe(false)
  })
})
