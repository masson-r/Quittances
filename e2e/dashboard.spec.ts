import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const MOBILE = { width: 390, height: 844 }
const YEAR = '?periode=perso&du=2026-01-01&au=2026-12-31'

/** Un bail depuis janvier 2026 : janvier soldé, février payé à moitié ; une dépense en février. */
async function seedStructure(entityId: string, label: string, opts: { rent: number; payments: [number, string][]; charges: [string, string][]; expense?: number }) {
  const property = await operatorQuery("insert into public.properties (entity_id, label) values ($1, $2) returning id", [entityId, label])
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name) values ($1, 'Locataire') returning id", [entityId])
  const lease = await operatorQuery("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2026-01-01', 5) returning id", [entityId, property.rows[0].id])
  await operatorQuery("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-01-01')", [entityId, lease.rows[0].id, tenant.rows[0].id])
  await operatorQuery("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-01-01', $3, 0)", [entityId, lease.rows[0].id, opts.rent])
  const chargeIds: string[] = []
  for (const [start, due] of opts.charges) {
    const end = start.slice(0, 8) + (start.slice(5, 7) === '02' ? '28' : '31')
    const c = await operatorQuery("insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, $3, $4, $5, $6, 0) returning id", [entityId, lease.rows[0].id, start, end, due, opts.rent])
    chargeIds.push(c.rows[0].id)
  }
  for (const [i, [amount, on]] of opts.payments.entries()) {
    const p = await operatorQuery("insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode) values ($1, $2, $3, $4, 'transfer') returning id", [entityId, lease.rows[0].id, amount, on])
    await operatorQuery('insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values ($1, $2, $3, $4, $5)', [entityId, lease.rows[0].id, p.rows[0].id, chargeIds[i], amount])
  }
  if (opts.expense) {
    await operatorQuery(
      "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents) select $1::uuid, $2::uuid, id, '2026-02-20', 'Plomberie', $3 from public.expense_categories where entity_id = $1::uuid and name = 'Travaux'",
      [entityId, property.rows[0].id, opts.expense],
    )
  }
}

for (const [name, viewport] of [
  ['bureau', undefined],
  ['mobile 390 px', MOBILE],
] as const) {
  test(`tableau de bord (${name}) : bandeau, évolution, comparaison par bien, filtres, vue consolidée`, async ({ page }) => {
    if (viewport) await page.setViewportSize(viewport)
    const main = page.getByRole('main')
    const kpi = (id: string) => main.getByTestId(`kpi-${id}`).locator('dd').first()
    const admin = await adminWithStructure(page)
    await seedStructure(admin.entityId, 'Appartement 1', {
      rent: 85000,
      charges: [['2026-01-01', '2026-01-05'], ['2026-02-01', '2026-02-05']],
      payments: [[85000, '2026-01-03'], [30000, '2026-02-10']],
      expense: 12000,
    })

    await page.goto(`/espace/${admin.entityId}/tableau-de-bord${YEAR}`)
    await expect(main.getByRole('heading', { name: 'Tableau de bord', level: 1 })).toBeVisible()
    await expect(kpi('called')).toHaveText(/1\s?700,00/)
    await expect(kpi('collected')).toHaveText(/1\s?150,00/)
    await expect(kpi('expenses')).toHaveText(/120,00/)
    await expect(kpi('balance')).toHaveText(/1\s?030,00/)
    await expect(kpi('overdue')).toHaveText(/550,00/)
    await expect(kpi('remaining')).toHaveText(/550,00/)
    await expect(kpi('properties')).toHaveText('1')
    await expect(kpi('leases')).toHaveText('1')
    await expect(kpi('tenants')).toHaveText('1')
    await expect(main.getByText("n'est pas un résultat fiscal")).toBeVisible()
    await expect(main.getByTestId('monthly-chart')).toBeVisible()
    await expect(main.getByTestId('property-row')).toHaveCount(1)
    await expect(main.getByTestId('property-row')).toContainText('68 %') // 1 150 ÷ 1 700
    await expect(main.getByTestId('recent-operation').first()).toBeVisible()
    expect(await blockingViolations(page)).toEqual([])

    // Filtre de bien inexistant ignoré ; période personnalisée invalide : retour au mois en cours.
    await page.goto(`/espace/${admin.entityId}/tableau-de-bord?periode=perso&du=2026-12-31&au=2026-01-01&bien=pas-un-id`)
    await expect(kpi('called')).toBeVisible()

    // Vue consolidée : une seconde structure dont l'utilisateur est membre.
    const second = await operatorQuery("insert into public.ownership_entities (name, kind) values ('Structure B', 'sci') returning id")
    const secondId = second.rows[0].id as string
    await operatorQuery("insert into public.entity_memberships (entity_id, profile_id, role) select $1, id, 'administrator' from public.profiles where email = $2", [secondId, admin.email])
    await seedStructure(secondId, 'Studio B', { rent: 50000, charges: [['2026-03-01', '2026-03-05']], payments: [[50000, '2026-03-03']] })

    await page.goto(`/espace/${admin.entityId}/tableau-de-bord${YEAR}`)
    await expect(kpi('called')).toHaveText(/2\s?200,00/)
    await expect(kpi('collected')).toHaveText(/1\s?650,00/)
    await expect(kpi('expenses')).toHaveText(/120,00/)
    await expect(kpi('balance')).toHaveText(/1\s?530,00/)
    await expect(main.getByTestId('property-row')).toHaveCount(2)
    await expect(main.getByRole('columnheader', { name: 'Structure' })).toBeVisible()
    expect(await blockingViolations(page)).toEqual([])

    // Filtre sur une structure puis sur un bien.
    await page.goto(`/espace/${admin.entityId}/tableau-de-bord${YEAR}&structure=${secondId}`)
    await expect(kpi('called')).toHaveText(/500,00/)
    await expect(main.getByTestId('property-row')).toHaveCount(1)
    await expect(main.getByRole('columnheader', { name: 'Structure' })).toHaveCount(0)

    // Périodes glissantes : l'historique de 2026 est dans les cinq ans.
    await page.goto(`/espace/${admin.entityId}/tableau-de-bord?periode=5ans`)
    await expect(kpi('called')).toHaveText(/2\s?200,00/)
  })
}

test('tableau de bord : le lecteur le lit en entier', async ({ page }) => {
  const main = page.getByRole('main')
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  await seedStructure(entityId, 'Bien lecteur', { rent: 60000, charges: [['2026-01-01', '2026-01-05']], payments: [[60000, '2026-01-03']] })
  await page.goto(`/espace/${entityId}/tableau-de-bord${YEAR}`)
  await expect(main.getByTestId('kpi-called').locator('dd').first()).toHaveText(/600,00/)
  await expect(main.getByTestId('kpi-collected').locator('dd').first()).toHaveText(/600,00/)
  await expect(main.getByTestId('pending-access')).toHaveCount(0)
  expect(await blockingViolations(page)).toEqual([])
})
