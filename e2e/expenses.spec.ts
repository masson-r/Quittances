import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

test('dépenses : saisie avec justificatif, filtres, modification, annulation, catégories', async ({ page }) => {
  const main = page.getByRole('main')
  const field = (name: string | RegExp, exact = false) => main.getByLabel(name, { exact }).filter({ visible: true })
  const admin = await adminWithStructure(page)
  await operatorQuery("insert into public.properties (entity_id, label) values ($1, 'Appartement 1'), ($1, 'Garage')", [admin.entityId])

  await page.goto(`/espace/${admin.entityId}/depenses`)
  await waitForForms(page)
  expect(await blockingViolations(page)).toEqual([])
  await expect(main.getByText('Aucune dépense pour cette sélection.')).toBeVisible()

  // Validation côté serveur : montant nul.
  await field('Description').first().fill('Plomberie')
  await field('Date').first().fill('2026-02-10')
  await field('Montant (€)').first().fill('0')
  await main.getByRole('button', { name: 'Enregistrer la dépense' }).click()
  await expect(main.getByText('Saisissez un montant supérieur à zéro')).toBeVisible()

  // Justificatif invalide refusé, puis valide accepté.
  await field('Montant (€)').first().fill('120,50')
  await field('Justificatif (facultatif)').first().setInputFiles({ name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>') })
  await main.getByRole('button', { name: 'Enregistrer la dépense' }).click()
  await expect(main.getByRole('alert')).toContainText('PDF, un PNG ou un JPEG')
  await field('Justificatif (facultatif)').first().setInputFiles({ name: 'facture.png', mimeType: 'image/png', buffer: TINY_PNG })
  await main.getByRole('button', { name: 'Enregistrer la dépense' }).click()
  await expect(main.getByTestId('expense')).toHaveCount(1)
  await expect(main.getByTestId('expense-amount')).toHaveText(/120,50/)
  await expect(main.getByTestId('expenses-total')).toContainText('120,50')

  const stored = await operatorQuery('select d.id, d.file_path, d.content_type, d.sha256 from public.documents d where d.entity_id = $1', [admin.entityId])
  expect(stored.rows).toHaveLength(1)
  expect(stored.rows[0].content_type).toBe('image/png')

  // Téléchargement du justificatif par lien signé.
  const link = await page.request.get(`/justificatifs/${stored.rows[0].id}`, { maxRedirects: 0 })
  expect(link.status()).toBe(302)
  expect((await page.request.get(link.headers()['location'])).status()).toBe(200)
  expect(await blockingViolations(page)).toEqual([])

  // Filtres : catégorie et période.
  await page.goto(`/espace/${admin.entityId}/depenses?du=2026-03-01`)
  await expect(main.getByTestId('expense')).toHaveCount(0)
  await page.goto(`/espace/${admin.entityId}/depenses?du=2026-02-01&au=2026-02-28`)
  await expect(main.getByTestId('expense')).toHaveCount(1)

  // Modification puis annulation avec motif.
  await waitForForms(page)
  await main.getByText('Modifier ou annuler').click()
  await main.getByRole('button', { name: /Enregistrer les modifications de Plomberie/ }).scrollIntoViewIfNeeded()
  const edit = main.getByTestId('expense').first()
  await edit.getByLabel('Montant (€)').fill('150')
  await edit.getByRole('button', { name: /Enregistrer les modifications/ }).click()
  await expect(main.getByTestId('expense-amount')).toHaveText(/150,00/)
  await edit.getByLabel("Motif de l'annulation").fill('Doublon')
  await edit.getByRole('button', { name: /Annuler la dépense/ }).click()
  await expect(main.getByTestId('expense')).toHaveCount(0)
  await page.goto(`/espace/${admin.entityId}/depenses?annulees=1`)
  await expect(main.getByTestId('expense')).toContainText('ANNULÉE (Doublon)')
  const kept = await operatorQuery('select count(*)::int as n, count(*) filter (where cancelled_at is not null)::int as c from public.expenses where entity_id = $1', [admin.entityId])
  expect(kept.rows[0]).toEqual({ n: 1, c: 1 })

  // Catégories : ajout, doublon refusé, archivage.
  await waitForForms(page)
  await main.getByLabel('Nouvelle catégorie').fill('Jardinage')
  await main.getByRole('button', { name: 'Ajouter' }).click()
  await expect(main.getByTestId('category')).toHaveCount(8)
  await main.getByLabel('Nouvelle catégorie').fill('jardinage')
  await main.getByRole('button', { name: 'Ajouter' }).click()
  await expect(main.getByRole('alert')).toContainText('porte déjà ce nom')
  await main.getByRole('button', { name: 'Archiver Jardinage' }).click()
  await expect(main.getByTestId('category').filter({ hasText: 'Jardinage (archivée)' })).toBeVisible()
  expect(await blockingViolations(page)).toEqual([])
})

test('dépenses : le lecteur consulte sans pouvoir saisir ni gérer les catégories', async ({ page }) => {
  const main = page.getByRole('main')
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const property = await operatorQuery("insert into public.properties (entity_id, label) values ($1, 'Bien lecteur') returning id", [entityId])
  await operatorQuery(
    "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents) select $1::uuid, $2::uuid, id, '2026-02-01', 'Assurance annuelle', 30000 from public.expense_categories where entity_id = $1::uuid and name = 'Assurance'",
    [entityId, property.rows[0].id],
  )
  await page.goto(`/espace/${entityId}/depenses`)
  await expect(main.getByTestId('expense')).toHaveCount(1)
  await expect(main.getByRole('heading', { name: 'Nouvelle dépense' })).toHaveCount(0)
  await expect(main.getByRole('heading', { name: 'Catégories' })).toHaveCount(0)
  await expect(main.getByText('Modifier ou annuler')).toHaveCount(0)
})
