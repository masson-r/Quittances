import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
/** Premier jour du mois situé trois mois avant le mois en cours. */
const START = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)))
const TODAY = iso(now)

async function seedLease(entityId: string, tenantFirst = 'Alice') {
  const property = await operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city) values ($1, 'Studio Gare', '3 rue de la Gare', '69003', 'Lyon') returning id", [entityId])
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name, first_name) values ($1, 'Martin', $2) returning id", [entityId, tenantFirst])
  const lease = await operatorQuery("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, $3, 1) returning id", [entityId, property.rows[0].id, START])
  await operatorQuery('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, 80000, 5000)', [entityId, lease.rows[0].id, START])
  await operatorQuery('insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, $4)', [entityId, lease.rows[0].id, tenant.rows[0].id, START])
  const created = await operatorQuery('select app.create_due_rent_charges($1) as n', [lease.rows[0].id])
  return { leaseId: lease.rows[0].id as string, charges: created.rows[0].n as number }
}

test('paiement partiel puis complément, correction, annulation et espèces', async ({ page }) => {
  test.setTimeout(420_000)
  const admin = await adminWithStructure(page)
  const { leaseId, charges } = await seedLease(admin.entityId)
  expect(charges).toBeGreaterThanOrEqual(4)
  const main = page.getByRole('main')
  const visible = <T extends { filter: (o: { visible: boolean }) => T }>(l: T) => l.filter({ visible: true })

  await page.goto(`/espace/${admin.entityId}/paiements`)
  await expect(main.getByTestId('charge')).toHaveCount(charges)
  await expect(main.getByTestId('charge').first()).toHaveAttribute('data-status', 'late')
  expect(await blockingViolations(page)).toEqual([])

  // Premier paiement : 1 000 € couvrent l'échéance la plus ancienne (850 €) et 150 € de la suivante.
  await main.getByRole('link', { name: 'Saisir un paiement' }).click()
  await waitForForms(page)
  await visible(main.getByLabel('Bail')).selectOption({ label: 'Studio Gare — Alice Martin' })
  await visible(main.getByLabel('Montant reçu (€)')).fill('1000,00')
  const inputs = visible(main.locator('input[name^="alloc_"]'))
  await expect(inputs).toHaveCount(charges)
  await expect(inputs.nth(0)).toHaveValue('850,00')
  await expect(inputs.nth(1)).toHaveValue('150,00')
  await expect(inputs.nth(2)).toHaveValue('')
  await expect(main.getByTestId('unallocated')).toContainText('0,00')
  await visible(main.getByLabel('Date de réception')).fill(TODAY)
  await visible(main.getByLabel('Référence (facultative)')).fill('VIR-001')
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()

  await expect(main.getByRole('heading', { name: /Paiement de 1\s000,00\s€/ })).toBeVisible()
  await expect(main.getByTestId('allocation')).toHaveCount(2)
  await expect(main.getByTestId('remaining')).toHaveCount(0)
  const firstPaymentUrl = page.url()

  await page.goto(`/espace/${admin.entityId}/paiements`)
  const rows = main.getByTestId('charge')
  await expect(rows.nth(charges - 1)).toHaveAttribute('data-status', 'paid')
  await expect(rows.nth(charges - 2)).toHaveAttribute('data-status', 'late') // partiellement payée mais en retard
  await expect(rows.nth(charges - 2)).toContainText('payé 150,00')

  // Complément : 700 € soldent la deuxième échéance.
  await page.goto(`/espace/${admin.entityId}/paiements/nouveau?bail=${leaseId}`)
  await waitForForms(page)
  await visible(main.getByLabel('Montant reçu (€)')).fill('700')
  await expect(visible(main.locator('input[name^="alloc_"]')).first()).toHaveValue('700,00')
  await visible(main.getByLabel('Date de réception')).fill(TODAY)
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByRole('heading', { name: /Paiement de 700,00\s€/ })).toBeVisible()
  await page.goto(`/espace/${admin.entityId}/paiements`)
  await expect(main.getByTestId('charge').nth(charges - 2)).toHaveAttribute('data-status', 'paid')

  // Un paiement en avance reste non affecté ; plus rien n'est dû avant la prochaine échéance.
  await page.goto(`/espace/${admin.entityId}/paiements/nouveau?bail=${leaseId}`)
  await waitForForms(page)
  await visible(main.getByLabel('Montant reçu (€)')).fill('85')
  await visible(main.getByLabel('Date de réception')).fill(TODAY)
  await visible(main.locator('input[name^="alloc_"]')).first().fill('')
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByTestId('remaining')).toContainText('85,00')

  // Espèces à partir de 1 000 € : avertissement puis confirmation
  await page.goto(`/espace/${admin.entityId}/paiements/nouveau?bail=${leaseId}`)
  await waitForForms(page)
  await visible(main.getByLabel('Montant reçu (€)')).fill('1000')
  await visible(main.getByLabel('Mode de paiement')).selectOption({ label: 'Espèces' })
  await expect(main.getByRole('alert').filter({ hasText: 'plafond légal' })).toBeVisible()
  await visible(main.getByLabel('Date de réception')).fill(TODAY)
  await visible(main.locator('input[name^="alloc_"]')).first().fill('')
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByText('confirmez-le pour continuer')).toBeVisible()
  await visible(main.getByLabel('Je confirme ce paiement en espèces')).check()
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByRole('heading', { name: /Paiement de 1\s000,00\s€/ })).toBeVisible()

  // Correction en place puis annulation du premier paiement
  await page.goto(firstPaymentUrl)
  await waitForForms(page)
  await visible(main.getByLabel('Référence')).fill('VIR-001-CORRIGE')
  await main.getByRole('button', { name: 'Enregistrer les corrections' }).click()
  await expect(main.getByText('Paiement corrigé.')).toBeVisible()

  await main.getByLabel('Motif de l\'annulation du paiement').fill('Doublon de saisie')
  await main.getByRole('button', { name: 'Annuler ce paiement' }).click()
  await expect(main.getByRole('heading', { name: /\(annulé\)/ })).toBeVisible()
  await expect(main.getByText('Doublon de saisie').first()).toBeVisible()
  await page.goto(`/espace/${admin.entityId}/paiements`)
  await expect(main.getByTestId('charge').nth(charges - 1)).toHaveAttribute('data-status', 'late')
  const audits = await operatorQuery("select action from public.audit_logs where entity_id = $1 and action in ('payment.created', 'payment.cancelled', 'payment.updated', 'payment.cash_warning_confirmed') order by action", [admin.entityId])
  expect(audits.rows.map((r) => r.action)).toEqual(['payment.cancelled', 'payment.cash_warning_confirmed', 'payment.created', 'payment.created', 'payment.created', 'payment.created', 'payment.updated'])
})

test('déplacer une affectation et annuler une échéance sans paiement', async ({ page }) => {
  test.setTimeout(300_000)
  const admin = await adminWithStructure(page)
  const { leaseId, charges } = await seedLease(admin.entityId)
  const main = page.getByRole('main')
  const visible = <T extends { filter: (o: { visible: boolean }) => T }>(l: T) => l.filter({ visible: true })

  // Paiement affecté à l'échéance la plus ancienne, puis déplacé vers la suivante.
  await page.goto(`/espace/${admin.entityId}/paiements/nouveau?bail=${leaseId}`)
  await waitForForms(page)
  await visible(main.getByLabel('Montant reçu (€)')).fill('850')
  await visible(main.getByLabel('Date de réception')).fill(TODAY)
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByTestId('allocation')).toHaveCount(1)

  await main.getByText('Corriger cette affectation').click()
  const target = visible(main.getByLabel(/Déplacer \(.+\) vers/))
  // La destination est l'échéance ouverte la plus ancienne (dernière de la liste) : la plus récente reste sans paiement.
  await target.selectOption({ index: (await target.locator('option').count()) - 1 })
  await visible(main.getByLabel('Motif du déplacement')).fill('Mauvaise échéance')
  await main.getByRole('button', { name: /Déplacer l'affectation/ }).click()
  await expect(main.getByTestId('allocation')).toHaveCount(2)
  await expect(main.getByTestId('allocation').first()).toHaveAttribute('data-reversed', 'true')

  // Une échéance sans paiement peut être annulée, avec motif ; elle n'est jamais supprimée.
  await page.goto(`/espace/${admin.entityId}/paiements`)
  const last = main.getByTestId('charge').first()
  await last.getByText('Corriger cette échéance').click()
  await last.getByLabel(/Motif de l'annulation/).fill('Bail suspendu')
  await last.getByRole('button', { name: /Annuler l'échéance/ }).click()
  await expect(main.getByTestId('charge')).toHaveCount(charges - 1)
  await main.getByRole('link', { name: 'Afficher les échéances annulées' }).click()
  await expect(main.getByTestId('charge').filter({ hasText: 'Annulée' })).toHaveCount(1)
  const count = await operatorQuery('select count(*)::int as n from public.rent_charges where lease_id = $1', [leaseId])
  expect(count.rows[0].n).toBe(charges)
})

test('le lecteur consulte échéances et paiements sans pouvoir saisir', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  await seedLease(entityId)
  const main = page.getByRole('main')
  await page.goto(`/espace/${entityId}/paiements`)
  await expect(main.getByTestId('charge').first()).toBeVisible()
  await expect(main.getByRole('link', { name: 'Saisir un paiement' })).toHaveCount(0)
  await expect(main.getByText('Corriger cette échéance')).toHaveCount(0)
  await page.goto(`/espace/${entityId}/paiements/nouveau`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
