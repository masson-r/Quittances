import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const parisToday = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)

async function lease(entityId: string, label: string, start: string, end: string | null = null) {
  const property = await operatorQuery("insert into public.properties (entity_id, label) values ($1, $2) returning id", [entityId, label])
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name, first_name) values ($1, $2, 'Alice') returning id", [entityId, `Locataire ${label}`])
  const l = await operatorQuery('insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, $3, $4, 5) returning id', [entityId, property.rows[0].id, start, end])
  await operatorQuery('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, 80000, 5000)', [entityId, l.rows[0].id, start])
  await operatorQuery('insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, $4, $5)', [entityId, l.rows[0].id, tenant.rows[0].id, start, end])
  return l.rows[0].id as string
}

async function charge(entityId: string, leaseId: string, dueOn: string) {
  const period = `${dueOn.slice(0, 7)}-01`
  const r = await operatorQuery(
    "insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, $3, $3::date + 27, $4, 80000, 5000) returning id",
    [entityId, leaseId, period, dueOn],
  )
  return r.rows[0].id as string
}

test('Impayés : une échéance passe en retard le lendemain de sa date, avec lien vers le bail', async ({ page }) => {
  test.setTimeout(300_000)
  const admin = await adminWithStructure(page)
  const today = parisToday()
  const lateLease = await lease(admin.entityId, 'Bien en retard', shift(today, -400))
  const dueTodayLease = await lease(admin.entityId, 'Bien échu aujourd’hui', shift(today, -400))
  await charge(admin.entityId, lateLease, shift(today, -1))
  await charge(admin.entityId, dueTodayLease, today)
  const main = page.getByRole('main')

  await page.goto(`/espace/${admin.entityId}/impayes`)
  await expect(main.getByRole('heading', { name: 'Impayés', level: 1 })).toBeVisible()
  // Échue hier : en retard. Échue aujourd'hui : pas encore.
  await expect(main.getByTestId('unpaid')).toHaveCount(1)
  await expect(main.getByTestId('unpaid')).toContainText('Bien en retard')
  await expect(main.getByTestId('days-late')).toHaveText('1 jour de retard')
  await expect(main.getByTestId('unpaid-total')).toContainText('850,00')
  expect(await blockingViolations(page)).toEqual([])

  await main.getByTestId('unpaid').getByRole('link', { name: /Bien en retard/ }).click()
  await expect(main.getByRole('heading', { name: 'Bail — Bien en retard', level: 1 })).toBeVisible()

  // Un paiement partiel laisse l'échéance en retard avec le reste dû ; un paiement complet la sort des impayés.
  const entity = admin.entityId
  await page.goto(`/espace/${entity}/paiements/nouveau?bail=${lateLease}`)
  await waitForForms(page)
  await main.getByLabel('Montant reçu (€)').filter({ visible: true }).fill('300')
  await main.getByLabel('Date de réception').filter({ visible: true }).fill(today)
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByRole('heading', { name: /Paiement de 300,00\s€/ })).toBeVisible()
  await page.goto(`/espace/${entity}/impayes`)
  await expect(main.getByTestId('unpaid')).toContainText('reste 550,00')

  await page.goto(`/espace/${entity}/paiements/nouveau?bail=${lateLease}`)
  await waitForForms(page)
  await main.getByLabel('Montant reçu (€)').filter({ visible: true }).fill('550')
  await main.getByLabel('Date de réception').filter({ visible: true }).fill(today)
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByRole('heading', { name: /Paiement de 550,00\s€/ })).toBeVisible()
  await page.goto(`/espace/${entity}/impayes`)
  await expect(main.getByTestId('no-unpaid')).toBeVisible()
})

test('le lecteur voit les impayés sans pouvoir saisir', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const l = await lease(entityId, 'Bien lecteur', shift(parisToday(), -400))
  await charge(entityId, l, shift(parisToday(), -10))
  const main = page.getByRole('main')
  await page.goto(`/espace/${entityId}/impayes`)
  await expect(main.getByTestId('days-late')).toHaveText('10 jours de retard')
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Impayés' })).toBeVisible()
})

test('apurement des charges : final obligatoire à la fin du bail, montants signés, annulation', async ({ page }) => {
  test.setTimeout(420_000)
  const admin = await adminWithStructure(page)
  const l = await lease(admin.entityId, 'Bien terminé', '2024-01-01', '2025-12-31')
  const main = page.getByRole('main')
  const labelled = (label: string) => main.getByLabel(label).filter({ visible: true })

  await page.goto(`/espace/${admin.entityId}/baux/${l}`)
  await expect(main.getByTestId('final-missing')).toContainText('Apurement final à saisir')
  await waitForForms(page)
  await main.getByText('Saisir un apurement').click()

  // Le zéro est réservé à l'apurement final ; la date ne peut pas être future.
  await labelled('Montant (€)').fill('0')
  await labelled('Date').first().fill('2026-01-15')
  await labelled('Motif').first().fill('Régularisation 2025')
  await main.getByRole('button', { name: "Enregistrer l'apurement" }).click()
  await expect(main.getByText('Un montant nul n’est permis que pour l’apurement final.')).toBeVisible()

  await main.getByLabel(/Apurement final du bail/).check()
  await main.getByRole('button', { name: "Enregistrer l'apurement" }).click()
  await expect(main.getByTestId('settlement')).toHaveCount(1)
  await expect(main.getByTestId('settlement')).toContainText('Apurement nul')
  await expect(main.getByTestId('settlement')).toContainText('apurement final')
  await expect(main.getByTestId('final-missing')).toHaveCount(0)

  // Plusieurs apurements : un remboursement (positif) et un complément reçu (négatif)
  await labelled('Montant (€)').fill('120,50')
  await labelled('Date').first().fill('2026-01-20')
  await labelled('Motif').first().fill('Remboursement de charges 2025')
  await main.getByRole('button', { name: "Enregistrer l'apurement" }).click()
  await expect(main.getByTestId('settlement')).toHaveCount(2)
  await labelled('Montant (€)').fill('-80')
  await labelled('Date').first().fill('2026-01-25')
  await labelled('Motif').first().fill('Complément de charges 2024')
  await main.getByRole('button', { name: "Enregistrer l'apurement" }).click()
  await expect(main.getByTestId('settlement')).toHaveCount(3)
  await expect(main.getByTestId('settlement').filter({ hasText: 'Remboursé : 120,50' })).toHaveCount(1)
  await expect(main.getByTestId('settlement').filter({ hasText: 'Complément reçu : 80,00' })).toHaveCount(1)

  // Un seul apurement final actif : en saisir un second est refusé.
  await main.getByLabel(/Apurement final du bail/).check()
  await labelled('Montant (€)').fill('0')
  await labelled('Date').first().fill('2026-01-26')
  await labelled('Motif').first().fill('Second final')
  await main.getByRole('button', { name: "Enregistrer l'apurement" }).click()
  await expect(main.getByText('Ce bail a déjà un apurement final')).toBeVisible()

  // Annuler l'apurement final : l'alerte revient ; rien n'est supprimé.
  const final = main.getByTestId('settlement').filter({ hasText: 'apurement final' })
  await final.getByText('Corriger cet apurement').click()
  await final.getByLabel("Motif de l'annulation de l'apurement").fill('Saisi trop tôt')
  await final.getByRole('button', { name: 'Annuler cet apurement' }).click()
  await expect(main.getByTestId('final-missing')).toBeVisible()
  await expect(main.getByTestId('settlement').filter({ hasText: 'annulé' })).toHaveCount(1)
  const kept = await operatorQuery('select count(*)::int as n from public.charge_settlements where lease_id = $1', [l])
  expect(kept.rows[0].n).toBe(3 + 0) // trois lignes valides ou annulées, aucune supprimée
})

test('le lecteur voit les apurements sans formulaire', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const l = await lease(entityId, 'Bien lecteur', '2024-01-01', '2025-12-31')
  const main = page.getByRole('main')
  await page.goto(`/espace/${entityId}/baux/${l}`)
  await expect(main.getByTestId('final-missing')).toBeVisible()
  await expect(main.getByText('Saisir un apurement')).toHaveCount(0)
})
