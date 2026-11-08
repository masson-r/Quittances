import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

async function seed(entityId: string) {
  const property = await operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city) values ($1, 'Studio Gare', '3 rue de la Gare', '69003', 'Lyon') returning id", [entityId])
  const tenants = await operatorQuery(
    "insert into public.tenants (entity_id, last_name, first_name) values ($1, 'Martin', 'Alice'), ($1, 'Durand', 'Paul') returning id, first_name",
    [entityId],
  )
  return { propertyId: property.rows[0].id as string, tenants: tenants.rows as { id: string; first_name: string }[] }
}

test('baux : création avec colocataires, conditions successives, sortie, fin de bail et historique des occupations', async ({ page }) => {
  test.setTimeout(360_000) // parcours long : création, conditions, sortie, fin de bail, second bail
  const admin = await adminWithStructure(page)
  const { propertyId } = await seed(admin.entityId)
  const main = page.getByRole('main')

  await page.goto(`/espace/${admin.entityId}/baux`)
  await expect(main.getByText('Aucun bail pour le moment.')).toBeVisible()
  await main.getByRole('link', { name: 'Nouveau bail' }).click()
  await waitForForms(page)
  expect(await blockingViolations(page)).toEqual([])

  // Un bail sans locataire est refusé, les saisies sont conservées.
  await main.getByLabel('Bien loué').selectOption({ label: 'Studio Gare' })
  await main.getByLabel('Date de début').fill('2025-01-01')
  await main.getByLabel("Jour d'échéance du loyer").fill('5')
  await main.getByLabel('Loyer mensuel (€)').fill('850,50')
  await main.getByLabel('Provisions pour charges (€)').fill('50')
  await main.getByRole('button', { name: 'Créer le bail' }).click()
  await expect(main.getByText('Choisissez au moins un locataire.')).toBeVisible()
  await expect(main.getByLabel('Loyer mensuel (€)')).toHaveValue('850,50')

  await main.getByLabel('Alice Martin').check()
  await main.getByLabel('Paul Durand').check()
  await main.getByRole('button', { name: 'Créer le bail' }).click()
  await expect(main.getByRole('heading', { name: 'Bail — Studio Gare', level: 1 })).toBeVisible()
  await expect(main.getByText(/850,50\s€/).first()).toBeVisible()
  await expect(main.getByTestId('presence')).toHaveCount(2)
  await expect(main.getByTestId('term')).toHaveCount(1)
  await waitForForms(page)

  // Nouvelle version des conditions
  await main.getByText('Modifier le loyer ou les charges').click()
  await main.getByLabel("Date d'effet").fill('2025-09-01')
  await main.getByLabel('Nouveau loyer (€)').fill('870')
  await main.getByLabel('Nouvelles charges (€)').fill('55')
  await main.getByLabel('Motif (facultatif)').fill('Révision annuelle')
  await main.getByRole('button', { name: 'Ajouter une version' }).click()
  await expect(main.getByText('Nouvelles conditions enregistrées.')).toBeVisible()
  await expect(main.getByTestId('term')).toHaveCount(2)
  await expect(main.getByTestId('term').first()).toContainText('Révision annuelle')
  // Une même date d'effet ne peut pas servir deux fois.
  await main.getByLabel("Date d'effet").fill('2025-09-01')
  await main.getByLabel('Nouveau loyer (€)').fill('900')
  await main.getByLabel('Nouvelles charges (€)').fill('55')
  await main.getByRole('button', { name: 'Ajouter une version' }).click()
  await expect(main.getByText('Une version des conditions existe déjà à cette date.')).toBeVisible()

  // Sortie d'un colocataire sans nouveau bail
  await main.getByLabel('Sortie de Paul Durand').fill('2025-10-31')
  await main.getByRole('button', { name: 'Enregistrer la sortie de Paul Durand' }).click()
  await expect(main.getByTestId('presence').filter({ hasText: 'Paul Durand' })).toContainText("jusqu'au 31 octobre 2025")

  // Fin de bail
  await main.getByLabel('Date de fin du bail').fill('2025-12-31')
  await main.getByRole('button', { name: 'Mettre fin au bail' }).click()
  await expect(main.getByText(/Terminé · du 1 janvier 2025 au 31 décembre 2025/)).toBeVisible()

  // Deuxième bail : le chevauchement est refusé, le bail successif accepté
  await page.goto(`/espace/${admin.entityId}/baux/nouveau`)
  await waitForForms(page)
  const create = async (start: string) => {
    await main.getByLabel('Bien loué').selectOption({ label: 'Studio Gare' })
    await main.getByLabel('Alice Martin').check()
    await main.getByLabel('Date de début').fill(start)
    await main.getByLabel("Jour d'échéance du loyer").fill('31')
    await main.getByLabel('Loyer mensuel (€)').fill('900')
    await main.getByLabel('Provisions pour charges (€)').fill('0')
    await main.getByRole('button', { name: 'Créer le bail' }).click()
  }
  await create('2025-12-01')
  await expect(main.getByText('Ce bien a déjà un bail sur tout ou partie de cette période.')).toBeVisible()
  await main.getByLabel('Date de début').fill('2026-01-01')
  await main.getByRole('button', { name: 'Créer le bail' }).click()
  await expect(main.getByRole('heading', { name: 'Bail — Studio Gare', level: 1 })).toBeVisible()

  // Historique des occupations du bien : deux baux successifs, rien de perdu
  await page.goto(`/espace/${admin.entityId}/biens/${propertyId}`)
  const occupations = main.getByTestId('occupation')
  await expect(occupations).toHaveCount(2)
  await expect(occupations.first()).toContainText('1 janvier 2026 → en cours')
  await expect(occupations.last()).toContainText('1 janvier 2025 → 31 décembre 2025')
  await expect(occupations.last()).toContainText('Alice Martin')
  await expect(occupations.last()).toContainText('Paul Durand')
  await expect(page.getByRole('heading', { name: "Historique des occupations" })).toBeVisible()
})

test('le lecteur consulte baux et occupations sans pouvoir rien modifier', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const { propertyId, tenants } = await seed(entityId)
  const lease = await operatorQuery("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2025-01-01', 5) returning id", [entityId, propertyId])
  await operatorQuery("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2025-01-01', 85000, 5000)", [entityId, lease.rows[0].id])
  await operatorQuery("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2025-01-01')", [entityId, lease.rows[0].id, tenants[0].id])

  const main = page.getByRole('main')
  await page.goto(`/espace/${entityId}/baux`)
  await expect(main.getByRole('link', { name: 'Nouveau bail' })).toHaveCount(0)
  await main.getByTestId('lease').getByRole('link').click()
  await expect(main.getByRole('heading', { name: 'Bail — Studio Gare', level: 1 })).toBeVisible()
  await expect(main.getByTestId('presence')).toContainText('Alice Martin')
  await expect(main.getByText('Mettre fin au bail')).toHaveCount(0)
  await expect(main.getByText('Ajouter un colocataire')).toHaveCount(0)
  await expect(main.getByText('Modifier le loyer ou les charges')).toHaveCount(0)

  await page.goto(`/espace/${entityId}/baux/nouveau`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
