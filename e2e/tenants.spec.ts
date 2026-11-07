import { test, expect } from '@playwright/test'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

test('dossiers locataires : création, coordonnées, informations sensibles, archivage sans suppression', async ({ page }) => {
  const admin = await adminWithStructure(page)
  const base = `/espace/${admin.entityId}/locataires`
  await page.goto(base)
  await expect(page.getByText('Aucun dossier pour le moment.')).toBeVisible()

  await page.getByRole('link', { name: 'Nouveau dossier' }).click()
  await waitForForms(page)
  await page.getByLabel('Prénom').fill('Alice')
  await page.getByLabel('Adresse e-mail').fill('pas-un-email')
  await page.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByText('Saisissez le nom.')).toBeVisible()
  await expect(page.getByText('Saisissez une adresse e-mail valide.')).toBeVisible()
  // Les valeurs saisies sont conservées après l'erreur.
  await expect(page.getByLabel('Prénom')).toHaveValue('Alice')

  await page.getByLabel('Nom', { exact: true }).fill('Martin')
  await page.getByLabel('Adresse e-mail').fill('Alice.Martin@Example.Test')
  await page.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByRole('heading', { name: 'Alice Martin', level: 1 })).toBeVisible()
  await waitForForms(page)
  await expect(page.getByLabel('Adresse e-mail')).toHaveValue('alice.martin@example.test')
  expect(await blockingViolations(page)).toEqual([])

  await page.getByLabel('Téléphone').fill('0102030405')
  await page.getByLabel(/Remise papier demandée/).filter({ visible: true }).check()
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Dossier enregistré.')).toBeVisible()

  // Informations sensibles
  await page.getByLabel('Date de naissance (facultative)').fill('2999-01-01')
  await page.getByRole('button', { name: 'Enregistrer les informations sensibles' }).click()
  await expect(page.getByText('Saisissez une date de naissance valide')).toBeVisible()
  await page.getByLabel('Date de naissance (facultative)').fill('1985-04-12')
  await page.getByLabel('Garant', { exact: true }).selectOption({ label: 'Visale' })
  await page.getByLabel('Aide au logement').selectOption({ label: 'Versée au locataire' })
  await page.getByRole('button', { name: 'Enregistrer les informations sensibles' }).click()
  await expect(page.getByText('Informations sensibles enregistrées.')).toBeVisible()
  const details = await operatorQuery('select guarantor_kind, housing_aid, birth_date::text as birth from public.tenant_private_details where entity_id = $1', [admin.entityId])
  expect(details.rows[0]).toEqual({ guarantor_kind: 'visale', housing_aid: 'to_tenant', birth: '1985-04-12' })

  // Archivage
  await page.getByRole('button', { name: 'Archiver le dossier' }).click()
  await expect(page.getByText('Dossier archivé.')).toBeVisible()
  await page.goto(base)
  await expect(page.getByTestId('tenant')).toHaveCount(0)
  await page.getByRole('link', { name: 'Afficher aussi les dossiers archivés' }).click()
  await expect(page.getByTestId('tenant')).toContainText('Alice Martin')
  const kept = await operatorQuery('select count(*)::int as n from public.tenants where entity_id = $1 and archived_at is not null', [admin.entityId])
  expect(kept.rows[0].n).toBe(1)
})

test('le lecteur voit le dossier sans informations sensibles ni formulaire', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  const tenant = await operatorQuery("insert into public.tenants (entity_id, last_name, first_name, email, phone) values ($1, 'Durand', 'Paul', 'paul@example.test', '0600000000') returning id", [entityId])
  await operatorQuery("insert into public.tenant_private_details (tenant_id, entity_id, guarantor_kind, guarantor_name, housing_aid) values ($1, $2, 'person', 'Madame Garant', 'to_landlord')", [tenant.rows[0].id, entityId])

  await page.goto(`/espace/${entityId}/locataires`)
  await expect(page.getByRole('link', { name: 'Nouveau dossier' })).toHaveCount(0)
  await page.getByTestId('tenant').getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Paul Durand', level: 1 })).toBeVisible()
  await expect(page.getByText('paul@example.test', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Informations sensibles' })).toHaveCount(0)
  await expect(page.getByText('Madame Garant')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Archiver le dossier' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Enregistrer/ })).toHaveCount(0)

  await page.goto(`/espace/${entityId}/locataires/nouveau`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
