import { test, expect, type Browser, type Page } from '@playwright/test'
import { adminWithStructure, confirmedUser, unique, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const BASE_URL = 'http://127.0.0.1:3000'
const MOBILE = { width: 390, height: 844 }

// Les essais ratés comptent par adresse réseau (ici toujours la même) : on repart de zéro à chaque test.
test.beforeEach(async () => {
  await operatorQuery('delete from public.invitation_attempts')
})

async function newVisitor(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport })
  return context.newPage()
}

/** Dossier locataire, bail, et lien de rattachement créé depuis la fiche du dossier. */
async function tenantWithLink(page: Page, entityId: string, tenantEmail: string) {
  const [property, tenant] = await Promise.all([
    operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city) values ($1, 'Appartement 3', '1 rue des Lilas', '75001', 'Paris') returning id", [entityId]),
    operatorQuery("insert into public.tenants (entity_id, last_name, first_name, email) values ($1, 'Durand', 'Alice', $2) returning id", [entityId, tenantEmail]),
  ])
  const lease = await operatorQuery("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2025-01-01', 5) returning id", [entityId, property.rows[0].id])
  await operatorQuery("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2025-01-01')", [entityId, lease.rows[0].id, tenant.rows[0].id])
  await operatorQuery("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2025-01-01', 70000, 5000)", [entityId, lease.rows[0].id])

  await page.goto(`/espace/${entityId}/locataires/${tenant.rows[0].id}`)
  await waitForForms(page)
  await page.getByRole('button', { name: "Créer un lien d'accès" }).click()
  const link = page.getByTestId('tenant-invitation-link')
  await expect(link).toBeVisible()
  return link.inputValue()
}

for (const [name, viewport] of [
  ['bureau', undefined],
  ['mobile 390 px', MOBILE],
] as const) {
  test(`rattachement d'un locataire (${name}) : demande avec consentement, validation, espace, retrait, révocation`, async ({ page, browser }) => {
    const admin = await adminWithStructure(page)
    const accountEmail = unique()
    const link = await tenantWithLink(page, admin.entityId, 'alice.durand@example.test')
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3000\/rattachement\/[0-9a-f]{64}$/)

    const tenant = await newVisitor(browser, viewport)
    await confirmedUser(tenant, accountEmail)

    // Avant tout rattachement : aucune donnée.
    await tenant.goto('/mon-espace')
    await expect(tenant.getByRole('heading', { name: 'Mon espace locataire', level: 1 })).toBeVisible()
    await expect(tenant.getByTestId('my-dossier')).toHaveCount(0)

    // Le consentement est obligatoire.
    await tenant.goto(link)
    await waitForForms(tenant)
    expect(await blockingViolations(tenant)).toEqual([])
    await tenant.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(tenant.getByRole('alert').filter({ hasText: 'consentir à la remise dématérialisée' })).toBeVisible()
    expect((await operatorQuery('select count(*)::int as n from public.tenant_access where entity_id = $1', [admin.entityId])).rows[0].n).toBe(0)

    await tenant.getByLabel(/Je consens/).check()
    await tenant.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(tenant).toHaveURL(/\/mon-espace$/)
    await expect(tenant.getByTestId('request-status')).toHaveText('En attente de validation')
    await expect(tenant.getByTestId('my-dossier')).toHaveCount(0)
    expect(await blockingViolations(tenant)).toEqual([])

    // Le lien est à usage unique.
    await tenant.goto(link)
    await waitForForms(tenant)
    await tenant.getByLabel(/Je consens/).check()
    await tenant.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(tenant.getByRole('alert').filter({ hasText: 'Lien invalide ou expiré.' })).toBeVisible()

    // Le propriétaire voit l'écart d'e-mail et valide.
    await page.goto(`/espace/${admin.entityId}/locataires`)
    await waitForForms(page)
    const request = page.getByTestId('access-request')
    await expect(request).toContainText(accountEmail)
    await expect(request.getByTestId('email-mismatch')).toBeVisible()
    await request.getByRole('button', { name: /Valider la demande/ }).click()
    await expect(page.getByTestId('access-request')).toHaveCount(0)

    // Espace du locataire : coordonnées et bail, rien de financier.
    await tenant.goto('/mon-espace')
    await waitForForms(tenant)
    await expect(tenant.getByTestId('request-status')).toHaveText('Validée')
    await expect(tenant.getByTestId('my-lease')).toContainText('Appartement 3')
    await expect(tenant.getByTestId('my-lease')).toContainText('Loyer 700,00')
    await expect(tenant.getByText(/échéance|solde|impayé/i)).toHaveCount(0)
    await tenant.getByLabel('Téléphone').fill('0612345678')
    await tenant.getByLabel('Ville').fill('Lyon')
    await tenant.getByRole('button', { name: 'Enregistrer mes coordonnées' }).click()
    await expect(tenant.getByRole('status').filter({ hasText: 'Coordonnées enregistrées.' })).toBeVisible()
    expect(await blockingViolations(tenant)).toEqual([])
    const saved = await operatorQuery('select phone, city, email from public.tenants where entity_id = $1', [admin.entityId])
    expect(saved.rows[0]).toEqual({ phone: '0612345678', city: 'Lyon', email: 'alice.durand@example.test' })

    // Retrait du consentement : la remise papier est signalée au propriétaire.
    tenant.once('dialog', (d) => d.accept())
    await tenant.getByRole('button', { name: /Retirer mon consentement/ }).click()
    await expect(tenant.getByText('Consentement retiré : vos quittances vous sont remises sur papier.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('main')).not.toContainText('Demandes de rattachement en attente')

    // Révocation par le propriétaire : effet immédiat côté locataire.
    await page.goto(`/espace/${admin.entityId}/locataires/${(await operatorQuery('select id from public.tenants where entity_id = $1', [admin.entityId])).rows[0].id}`)
    await waitForForms(page)
    await expect(page.getByText('Remise papier demandée par le locataire.')).toBeVisible()
    expect(await blockingViolations(page)).toEqual([])
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: /Révoquer l'accès/ }).click()
    await expect(page.getByTestId('access-status')).toHaveText('Révoquée')
    await tenant.reload()
    await expect(tenant.getByTestId('request-status')).toHaveText('Révoquée')
    await expect(tenant.getByTestId('my-dossier')).toHaveCount(0)
  })
}

test('refus d\'une demande ; le locataire peut se détacher lui-même', async ({ page, browser }) => {
  const admin = await adminWithStructure(page)
  const accountEmail = unique()
  const link = await tenantWithLink(page, admin.entityId, 'alice.durand@example.test')
  const tenant = await newVisitor(browser)
  await confirmedUser(tenant, accountEmail)
  await tenant.goto(link)
  await waitForForms(tenant)
  await tenant.getByLabel(/Je consens/).check()
  await tenant.getByRole('button', { name: 'Envoyer ma demande' }).click()
  await expect(tenant).toHaveURL(/\/mon-espace$/)

  await page.goto(`/espace/${admin.entityId}/locataires`)
  await waitForForms(page)
  await page.getByTestId('access-request').getByRole('button', { name: /Refuser la demande/ }).click()
  await expect(page.getByTestId('access-request')).toHaveCount(0)
  await tenant.reload()
  await expect(tenant.getByTestId('request-status')).toHaveText('Refusée')
})
