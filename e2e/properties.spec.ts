import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const MENU = 'Navigation principale'

test("biens : création, modification, notes en ajout seul, codes d'accès, archivage sans suppression", async ({ page }) => {
  const main = page.getByRole('main')
  // Next garde les pages quittées dans le DOM (masquées) : on ne vise que les champs visibles.
  const labelled = (...args: Parameters<typeof main.getByLabel>) => main.getByLabel(...args).filter({ visible: true })
  const admin = await adminWithStructure(page)
  const base = `/espace/${admin.entityId}/biens`
  await page.goto(base)
  await expect(main.getByText('Aucun bien pour le moment.')).toBeVisible()

  // Création
  await page.getByRole('link', { name: 'Nouveau bien' }).click()
  await waitForForms(page)
  await labelled('Libellé du bien').fill('T3 rue des Lilas')
  await labelled('Adresse', { exact: true }).fill('12 rue des Lilas')
  await labelled('Code postal').fill('7501')
  await labelled('Ville').fill('Paris')
  await page.getByRole('button', { name: 'Créer le bien' }).click()
  await expect(main.getByText('Le code postal comporte 5 chiffres.')).toBeVisible()
  await labelled('Code postal').fill('75011')
  await page.getByRole('button', { name: 'Créer le bien' }).click()
  await expect(page.getByRole('heading', { name: 'T3 rue des Lilas', level: 1 })).toBeVisible()
  await waitForForms(page)
  expect(await blockingViolations(page)).toEqual([])

  // Modification
  await labelled('Libellé du bien').fill('T3 Lilas')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(main.getByText('Bien enregistré.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'T3 Lilas', level: 1 })).toBeVisible()

  // Note de maintenance : ajout seul
  await labelled('Nouvelle note de maintenance').fill('Chaudière révisée')
  await page.getByRole('button', { name: 'Ajouter la note' }).click()
  await expect(main.getByTestId('note').first()).toContainText('Chaudière révisée')
  await expect(main.getByTestId('note').first().getByRole('button')).toHaveCount(0)

  // Codes d'accès
  await labelled('Libellé', { exact: true }).last().fill('Portail')
  await labelled('Code', { exact: true }).last().fill('4821')
  await page.getByRole('button', { name: 'Ajouter le code' }).click()
  const code = main.getByTestId('access-code')
  await expect(code).toHaveCount(1)
  await expect(code.getByLabel('Code', { exact: true })).toHaveValue('4821')
  await code.getByLabel('Code', { exact: true }).fill('9999')
  await code.getByRole('button', { name: /Enregistrer le code/ }).click()
  await expect(main.getByText('Code enregistré.').first()).toBeVisible()
  await code.getByRole('button', { name: /Supprimer le code/ }).click()
  await expect(main.getByTestId('access-code')).toHaveCount(0)

  // Archivage : le bien disparaît de la liste mais n'est pas supprimé
  await page.getByRole('button', { name: 'Archiver le bien' }).click()
  await expect(main.getByText('Bien archivé.')).toBeVisible()
  await page.goto(base)
  await expect(main.getByTestId('property')).toHaveCount(0)
  await page.getByRole('link', { name: 'Afficher aussi les biens archivés' }).click()
  await expect(main.getByTestId('property')).toContainText('T3 Lilas')
  await expect(main.getByTestId('property')).toContainText('(archivé)')
  const { rows } = await operatorQuery("select count(*)::int as n from public.properties where entity_id = $1 and archived_at is not null", [admin.entityId])
  expect(rows[0].n).toBe(1)

  await main.getByTestId('property').getByRole('link').click()
  await waitForForms(page)
  await page.getByRole('button', { name: 'Restaurer le bien' }).click()
  await expect(main.getByText('Bien restauré.')).toBeVisible()
})

test("le lecteur consulte les biens et les notes sans formulaire ni code d'accès", async ({ page }) => {
  const main = page.getByRole('main')
  // Next garde les pages quittées dans le DOM (masquées) : on ne vise que les champs visibles.
  const labelled = (...args: Parameters<typeof main.getByLabel>) => main.getByLabel(...args).filter({ visible: true })
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const property = await operatorQuery("insert into public.properties (entity_id, label, address_line1, postal_code, city, description) values ($1, 'Studio Gare', '3 rue de la Gare', '69003', 'Lyon', 'Au 2e étage') returning id", [entityId])
  const propertyId = property.rows[0].id
  await operatorQuery("insert into public.property_maintenance_notes (entity_id, property_id, body) values ($1, $2, 'Volets remplacés')", [entityId, propertyId])
  await operatorQuery("insert into public.property_access_codes (entity_id, property_id, label, code) values ($1, $2, 'Digicode', '1234')", [entityId, propertyId])

  await page.goto(`/espace/${entityId}/biens`)
  await expect(page.getByRole('link', { name: 'Nouveau bien' })).toHaveCount(0)
  await main.getByTestId('property').getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Studio Gare', level: 1 })).toBeVisible()
  await expect(main.getByText('Au 2e étage')).toBeVisible()
  await expect(main.getByTestId('note')).toContainText('Volets remplacés')
  await expect(page.getByRole('heading', { name: "Codes d'accès" })).toHaveCount(0)
  await expect(main.getByText('1234')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Archiver le bien' })).toHaveCount(0)
  await expect(labelled('Nouvelle note de maintenance')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: MENU }).getByRole('link', { name: 'Biens' })).toHaveAttribute('aria-current', 'page')

  await page.goto(`/espace/${entityId}/biens/nouveau`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
