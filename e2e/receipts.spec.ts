import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { adminWithStructure, confirmedUser, unique, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

/** Bail avec une échéance de janvier 2026 intégralement réglée en deux fois ; un seul locataire. */
async function seedPaidCharge(entityId: string) {
  const property = await operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city) values ($1, 'Appartement 3', '1 rue des Lilas', '75001', 'Paris') returning id", [entityId])
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name, first_name) values ($1, 'Durand', 'Alice') returning id", [entityId])
  const lease = await operatorQuery("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2026-01-01', 5) returning id", [entityId, property.rows[0].id])
  await operatorQuery("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-01-01')", [entityId, lease.rows[0].id, tenant.rows[0].id])
  await operatorQuery("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-01-01', 70000, 5000)", [entityId, lease.rows[0].id])
  const charge = await operatorQuery("insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, '2026-01-01', '2026-01-31', '2026-01-05', 70000, 5000) returning id", [entityId, lease.rows[0].id])
  for (const [amount, on] of [[40000, '2026-01-03'], [35000, '2026-01-12']] as const) {
    const payment = await operatorQuery("insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode) values ($1, $2, $3, $4, 'transfer') returning id", [entityId, lease.rows[0].id, amount, on])
    await operatorQuery('insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values ($1, $2, $3, $4, $5)', [entityId, lease.rows[0].id, payment.rows[0].id, charge.rows[0].id, amount])
  }
  return { tenantId: tenant.rows[0].id as string }
}

test('quittance : émission, PDF unique avec empreinte, téléchargement par lien de 60 secondes, accès direct refusé, locataire rattaché', async ({ page, browser }) => {
  test.setTimeout(300_000)
  const main = page.getByRole('main')
  const admin = await adminWithStructure(page)
  const { tenantId } = await seedPaidCharge(admin.entityId)

  await page.goto(`/espace/${admin.entityId}/quittances`)
  await waitForForms(page)
  await expect(main.getByTestId('issuable')).toHaveCount(1)
  expect(await blockingViolations(page)).toEqual([])

  // Un reçu postérieur à l'émission est refusé par la base.
  await main.getByLabel("Date d'émission").fill('2026-01-05')
  await main.getByRole('button', { name: /^Émettre/ }).click()
  await expect(main.getByRole('alert')).toContainText('postérieure')
  await main.getByLabel("Date d'émission").fill('')
  await main.getByRole('button', { name: /^Émettre/ }).click()
  await expect(main.getByTestId('receipt')).toHaveCount(1)
  await expect(main.getByTestId('receipt-state')).toHaveText('Disponible')
  await expect(main.getByTestId('receipt-number')).toHaveText(/^QUI-\d{4}-\d{2}-0001$/)
  await expect(main.getByTestId('nothing-to-issue')).toBeVisible()
  expect(await blockingViolations(page)).toEqual([])

  const stored = await operatorQuery('select id, file_path, file_sha256, file_size from public.receipts where entity_id = $1', [admin.entityId])
  expect(stored.rows).toHaveLength(1)
  const { id, file_path: path, file_sha256: sha } = stored.rows[0]

  // Téléchargement par le propriétaire : redirection vers un lien signé, PDF identique à l'empreinte enregistrée.
  const direct = await page.request.get(`/documents/${id}`, { maxRedirects: 0 })
  expect(direct.status()).toBe(302)
  const signed = direct.headers()['location']
  expect(signed).toContain('/storage/v1/object/sign/receipts/')
  const file = await page.request.get(signed)
  expect(file.status()).toBe(200)
  const body = await file.body()
  expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  expect(createHash('sha256').update(body).digest('hex')).toBe(sha)

  // Accès direct au bucket refusé : sans jeton, avec la clé publique, et même avec le chemin exact.
  for (const url of [`${SUPABASE}/storage/v1/object/receipts/${path}`, `${SUPABASE}/storage/v1/object/public/receipts/${path}`, `${SUPABASE}/storage/v1/object/authenticated/receipts/${path}`]) {
    const res = await page.request.get(url, { headers: { apikey: PUBLISHABLE } })
    expect(res.status(), url).toBeGreaterThanOrEqual(400)
  }
  const listing = await page.request.post(`${SUPABASE}/storage/v1/object/list/receipts`, { headers: { apikey: PUBLISHABLE }, data: { prefix: '' } })
  expect(await listing.text()).not.toContain(String(id))

  // Locataire rattaché : voit son document, le télécharge ; un autre compte non rattaché n'y a pas accès.
  const tenant = await (await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })).newPage()
  const tenantEmail = unique()
  await confirmedUser(tenant, tenantEmail)
  const adminProfile = await operatorQuery('select p.id from public.profiles p join public.entity_memberships m on m.profile_id = p.id where m.entity_id = $1', [admin.entityId])
  await operatorQuery("insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by, used_at) values ($1, 'tenant', $2, $3, $4, now())", [
    admin.entityId,
    tenantId,
    createHash('sha256').update(tenantEmail).digest('hex'),
    adminProfile.rows[0].id,
  ])
  await operatorQuery(
    "insert into public.tenant_access (entity_id, tenant_id, profile_id, invitation_id, consent_version, status, decided_at) select $1, $2, p.id, i.id, 'v1', 'active', now() from public.profiles p, public.invitations i where p.email = $3 and i.token_hash = $4",
    [admin.entityId, tenantId, tenantEmail, createHash('sha256').update(tenantEmail).digest('hex')],
  )
  await tenant.goto('/mon-espace')
  await expect(tenant.getByTestId('my-document')).toHaveCount(1)
  await expect(tenant.getByTestId('my-document')).toContainText('Quittance')
  expect(await blockingViolations(tenant)).toEqual([])
  const tenantDownload = await tenant.request.get(`/documents/${id}`, { maxRedirects: 0 })
  expect(tenantDownload.status()).toBe(302)

  const stranger = await (await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })).newPage()
  await confirmedUser(stranger)
  expect((await stranger.request.get(`/documents/${id}`, { maxRedirects: 0 })).status()).toBe(404)
  const anonymous = await (await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })).newPage()
  expect((await anonymous.request.get(`/documents/${id}`, { maxRedirects: 0 })).status()).toBe(303)

  // Le lien signé expire au bout de 60 secondes.
  await page.waitForTimeout(62_000)
  expect((await page.request.get(signed)).status()).toBeGreaterThanOrEqual(400)

  // Annulation par le propriétaire : le document disparaît côté locataire, reste téléchargeable côté propriétaire.
  await page.goto(`/espace/${admin.entityId}/quittances`)
  await waitForForms(page)
  await main.getByText('Annuler ou remplacer').click()
  await main.getByLabel("Motif de l'annulation").fill('Erreur de période')
  await main.getByRole('button', { name: /^Annuler QUI/ }).click()
  await expect(main.getByTestId('receipt-state')).toHaveText('Annulé')
  await expect(main.getByTestId('issuable')).toHaveCount(1)
  await tenant.reload()
  await expect(tenant.getByTestId('my-document')).toHaveCount(0)
  expect((await tenant.request.get(`/documents/${id}`, { maxRedirects: 0 })).status()).toBe(404)
  expect((await page.request.get(`/documents/${id}`, { maxRedirects: 0 })).status()).toBe(302)
})
