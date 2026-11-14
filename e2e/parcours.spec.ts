import { test, expect, type Browser, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { adminWithStructure, confirmedUser, enrollSecondFactor, freshTotp, signIn, signOut, unique, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

/**
 * L6-01. Les six parcours critiques de la stratégie de test (ticket 009), bureau et mobile 390 px, avec un contrôle
 * d'accessibilité axe bloquant. Les préparations qui ne sont pas l'objet du parcours passent par l'opérateur (SQL).
 */
const MOBILE = { width: 390, height: 844 }
const BASE_URL = 'http://127.0.0.1:3000'
const iso = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const START = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))
const TODAY = iso(now)

// Les essais ratés comptent par adresse réseau : on repart de zéro.
test.beforeEach(async () => {
  await operatorQuery('delete from public.invitation_attempts')
})

async function visitor(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  return (await browser.newContext({ baseURL: BASE_URL, viewport })).newPage()
}

/** Bien, dossier et bail commencé le mois dernier : deux échéances échues (800 € + 50 €). */
async function seedLease(entityId: string, tenantEmail: string | null = null) {
  const property = await operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city) values ($1, 'Studio Gare', '3 rue de la Gare', '69003', 'Lyon') returning id", [entityId])
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name, first_name, email) values ($1, 'Martin', 'Alice', $2) returning id", [entityId, tenantEmail])
  const lease = await operatorQuery('insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, $3, 1) returning id', [entityId, property.rows[0].id, START])
  await operatorQuery('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, 80000, 5000)', [entityId, lease.rows[0].id, START])
  await operatorQuery('insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, $4)', [entityId, lease.rows[0].id, tenant.rows[0].id, START])
  const created = await operatorQuery('select app.create_due_rent_charges($1) as n', [lease.rows[0].id])
  return { propertyId: property.rows[0].id as string, tenantId: tenant.rows[0].id as string, leaseId: lease.rows[0].id as string, charges: created.rows[0].n as number }
}

async function pay(page: Page, entityId: string, leaseId: string, amount: string): Promise<string> {
  const main = page.getByRole('main')
  const visibleLabel = (label: string) => main.getByLabel(label).filter({ visible: true })
  await page.goto(`/espace/${entityId}/paiements/nouveau?bail=${leaseId}`)
  await waitForForms(page)
  await visibleLabel('Montant reçu (€)').fill(amount)
  await visibleLabel('Date de réception').fill(TODAY)
  await main.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(main.getByRole('heading', { name: /Paiement de/ })).toBeVisible()
  return page.url()
}

async function issue(page: Page, entityId: string, kindLabel: 'Reçu partiel' | 'Quittance') {
  const main = page.getByRole('main')
  await page.goto(`/espace/${entityId}/quittances`)
  await waitForForms(page)
  const item = main.getByTestId('issuable').filter({ hasText: kindLabel }).first()
  await item.getByRole('button', { name: /^Émettre/ }).click()
  await expect(main.getByTestId('receipt').filter({ hasText: kindLabel })).toHaveCount(1)
}

test('parcours 1 : structure créée par l\'opérateur, invitation de l\'administrateur, connexion avec second facteur', async ({ page }) => {
  const email = unique()
  const created = await operatorQuery("select * from public.create_structure('SCI du parcours', 'sci', $1)", [email])
  const { entity_id: entityId, token } = created.rows[0]

  // L'invité crée son compte, accepte l'invitation liée à son e-mail vérifié, puis active son second facteur.
  await confirmedUser(page, email)
  await page.goto(`/invitation/${token}`)
  await waitForForms(page)
  await page.getByRole('button', { name: "Accepter l'invitation" }).click()
  await expect(page).toHaveURL(/\/securite\/activation/)
  const { secret, code } = await enrollSecondFactor(page)
  await page.getByRole('link', { name: /continuer/ }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await page.goto('/espace')
  await expect(page.getByTestId('my-structure').filter({ visible: true })).toContainText('SCI du parcours')
  expect(await blockingViolations(page)).toEqual([])

  // Le journal garde la création par l'opérateur et l'acceptation, sans donnée personnelle.
  const audit = await operatorQuery("select action, actor_kind from public.audit_logs where entity_id = $1 and action in ('structure.created', 'invitation.used')", [entityId])
  expect(audit.rows.map((r) => `${r.action}:${r.actor_kind}`).sort()).toEqual(['invitation.used:user', 'structure.created:operator'])

  // Reconnexion : le second facteur est redemandé.
  await signOut(page)
  await signIn(page, email)
  await expect(page).toHaveURL(/\/securite\/verification/)
  await page.getByLabel('Code à 6 chiffres').fill(await freshTotp(secret, code))
  await page.getByRole('button', { name: 'Valider' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  // L'utilisateur reste sur son espace : le code validé ne le renvoie pas vers la vérification.
  await page.waitForTimeout(3000)
  await expect(page).toHaveURL(/\/espace$/)
  await page.getByTestId('my-structure').filter({ visible: true }).getByRole('link').click()
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Membres' })).toBeVisible()
})

test('parcours 2 : bien, dossier et bail créés, les échéances échues apparaissent', async ({ page }) => {
  test.setTimeout(300_000)
  const main = page.getByRole('main')
  const admin = await adminWithStructure(page)
  await operatorQuery("select set_config('app.actor_kind', 'operator', true)")

  await page.goto(`/espace/${admin.entityId}/biens/nouveau`)
  await waitForForms(page)
  await main.getByLabel('Libellé du bien').fill('Studio Gare')
  await main.getByLabel('Adresse', { exact: true }).fill('3 rue de la Gare')
  await main.getByLabel('Code postal').fill('69003')
  await main.getByLabel('Ville').fill('Lyon')
  await main.getByRole('button', { name: 'Créer le bien' }).click()
  await expect(page.getByRole('heading', { name: 'Studio Gare', level: 1 })).toBeVisible()

  await page.goto(`/espace/${admin.entityId}/locataires/nouveau`)
  await waitForForms(page)
  await main.getByLabel('Prénom').fill('Alice')
  await main.getByLabel('Nom', { exact: true }).fill('Martin')
  await main.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByRole('heading', { name: 'Alice Martin', level: 1 })).toBeVisible()

  await page.goto(`/espace/${admin.entityId}/baux/nouveau`)
  await waitForForms(page)
  await main.getByLabel('Bien loué').selectOption({ label: 'Studio Gare' })
  await main.getByLabel('Alice Martin').check()
  await main.getByLabel('Date de début').fill(START)
  await main.getByLabel("Jour d'échéance du loyer").fill('1')
  await main.getByLabel('Loyer mensuel (€)').fill('800')
  await main.getByLabel('Provisions pour charges (€)').fill('50')
  await main.getByRole('button', { name: 'Créer le bail' }).click()
  await expect(main.getByRole('heading', { name: 'Bail — Studio Gare', level: 1 })).toBeVisible()
  expect(await blockingViolations(page)).toEqual([])

  // Les échéances échues sont créées dès la saisie du bail (rattrapage), la plus ancienne en retard.
  await page.goto(`/espace/${admin.entityId}/paiements`)
  await expect(main.getByTestId('charge')).toHaveCount(2)
  await expect(main.getByTestId('charge').first()).toContainText('850,00')
  expect(await blockingViolations(page)).toEqual([])
})

test('parcours 3 et 5 : paiement partiel, impayé, complément, quittance, PDF ; annulation d\'un paiement qui a une quittance', async ({ page }) => {
  test.setTimeout(420_000)
  const main = page.getByRole('main')
  const admin = await adminWithStructure(page)
  const { leaseId } = await seedLease(admin.entityId)

  // Paiement partiel : 400 € sur 850 €. L'échéance reste impayée (page Impayés) et un reçu est possible.
  await pay(page, admin.entityId, leaseId, '400')
  await page.goto(`/espace/${admin.entityId}/impayes`)
  await expect(main).toContainText('450,00')
  expect(await blockingViolations(page)).toEqual([])
  await issue(page, admin.entityId, 'Reçu partiel')
  await expect(main.getByTestId('receipt-number')).toHaveText(/^REC-\d{4}-\d{2}-0001$/)

  // Complément de 450 € : l'échéance est soldée, la quittance devient possible.
  const complementUrl = await pay(page, admin.entityId, leaseId, '450')
  await issue(page, admin.entityId, 'Quittance')
  const stored = await operatorQuery("select id, file_sha256 from public.receipts where entity_id = $1 and kind = 'quittance'", [admin.entityId])
  const { id, file_sha256: sha } = stored.rows[0]

  // Téléchargement : lien signé, PDF identique à l'empreinte enregistrée.
  const redirect = await page.request.get(`/documents/${id}`, { maxRedirects: 0 })
  expect(redirect.status()).toBe(302)
  const file = await (await page.request.get(redirect.headers()['location'])).body()
  expect(file.subarray(0, 5).toString()).toBe('%PDF-')
  expect(createHash('sha256').update(file).digest('hex')).toBe(sha)
  expect(await blockingViolations(page)).toEqual([])

  // Parcours 5 : annuler le paiement complémentaire est refusé tant que la quittance existe.
  await page.goto(complementUrl)
  await waitForForms(page)
  await main.getByLabel("Motif de l'annulation du paiement").fill('Erreur de saisie')
  await main.getByRole('button', { name: 'Annuler ce paiement' }).click()
  await expect(main.getByRole('alert')).toContainText("annulez-le d'abord")

  await page.goto(`/espace/${admin.entityId}/quittances`)
  await waitForForms(page)
  const quittance = main.getByTestId('receipt').filter({ hasText: 'QUI-' })
  await quittance.getByText('Annuler ou remplacer').click()
  await quittance.getByLabel("Motif de l'annulation").fill('Paiement erroné')
  await quittance.getByRole('button', { name: /^Annuler QUI/ }).click()
  await expect(quittance.getByTestId('receipt-state')).toHaveText('Annulé')

  await page.goto(complementUrl)
  await waitForForms(page)
  await main.getByLabel("Motif de l'annulation du paiement").fill('Erreur de saisie')
  await main.getByRole('button', { name: 'Annuler ce paiement' }).click()
  await expect(main.getByRole('heading', { name: /\(annulé\)/ })).toBeVisible()
})

test('parcours 4 : invitation d\'un locataire, demande, validation, téléchargement de la quittance sur mobile', async ({ page, browser }) => {
  test.setTimeout(420_000)
  const main = page.getByRole('main')
  const admin = await adminWithStructure(page)
  const { leaseId, tenantId } = await seedLease(admin.entityId, 'alice@example.test')
  await pay(page, admin.entityId, leaseId, '850')
  await issue(page, admin.entityId, 'Quittance')
  const receipt = (await operatorQuery('select id from public.receipts where entity_id = $1', [admin.entityId])).rows[0].id

  await page.goto(`/espace/${admin.entityId}/locataires/${tenantId}`)
  await waitForForms(page)
  await page.getByRole('button', { name: "Créer un lien d'accès" }).click()
  const link = await page.getByTestId('tenant-invitation-link').inputValue()

  const tenant = await visitor(browser, MOBILE)
  await confirmedUser(tenant, unique())
  await tenant.goto(link)
  await waitForForms(tenant)
  await tenant.getByLabel(/Je consens/).check()
  await tenant.getByRole('button', { name: 'Envoyer ma demande' }).click()
  await expect(tenant).toHaveURL(/\/mon-espace$/)
  await expect(tenant.getByTestId('request-status')).toHaveText('En attente de validation')
  await expect(tenant.getByTestId('my-document')).toHaveCount(0)

  await page.goto(`/espace/${admin.entityId}/locataires`)
  await waitForForms(page)
  await main.getByTestId('access-request').getByRole('button', { name: /Valider la demande/ }).click()
  await expect(main.getByTestId('access-request')).toHaveCount(0)

  await tenant.goto('/mon-espace')
  await expect(tenant.getByTestId('my-document')).toHaveCount(1)
  await expect(tenant.getByText(/échéance|solde|impayé/i)).toHaveCount(0)
  expect(await blockingViolations(tenant)).toEqual([])
  const download = await tenant.request.get(`/documents/${receipt}`, { maxRedirects: 0 })
  expect(download.status()).toBe(302)
  expect((await tenant.request.get(download.headers()['location'])).status()).toBe(200)
})

test('parcours 6 : accès direct par URL aux données d\'une autre structure ou d\'un autre locataire, refusé', async ({ page, browser }) => {
  test.setTimeout(420_000)
  const admin = await adminWithStructure(page)
  const { leaseId, tenantId } = await seedLease(admin.entityId)
  await pay(page, admin.entityId, leaseId, '850')
  await issue(page, admin.entityId, 'Quittance')
  const receipt = (await operatorQuery('select id from public.receipts where entity_id = $1', [admin.entityId])).rows[0].id

  // Administrateur d'une autre structure.
  const other = await visitor(browser)
  await adminWithStructure(other)
  for (const path of [
    `/espace/${admin.entityId}/tableau-de-bord`,
    `/espace/${admin.entityId}/paiements`,
    `/espace/${admin.entityId}/quittances`,
    `/espace/${admin.entityId}/locataires/${tenantId}`,
    `/espace/${admin.entityId}/baux/${leaseId}`,
  ]) {
    await other.goto(path)
    await expect(other.getByRole('heading', { name: '404' }), path).toBeVisible()
  }
  expect((await other.request.get(`/documents/${receipt}`, { maxRedirects: 0 })).status()).toBe(404)

  // Locataire sans rattachement : ni espace propriétaire, ni document.
  const stranger = await visitor(browser, MOBILE)
  await confirmedUser(stranger)
  await stranger.goto(`/espace/${admin.entityId}/quittances`)
  await expect(stranger.getByRole('heading', { name: '404' })).toBeVisible()
  expect((await stranger.request.get(`/documents/${receipt}`, { maxRedirects: 0 })).status()).toBe(404)
  await stranger.goto('/mon-espace')
  await expect(stranger.getByTestId('my-document')).toHaveCount(0)
  await expect(stranger.getByTestId('my-dossier')).toHaveCount(0)

  // Visiteur sans session : redirigé vers la connexion.
  const anonymous = await visitor(browser)
  await anonymous.goto(`/espace/${admin.entityId}/paiements`)
  await expect(anonymous).toHaveURL(/\/connexion/)
  expect((await anonymous.request.get(`/documents/${receipt}`, { maxRedirects: 0 })).status()).toBe(303)
})
