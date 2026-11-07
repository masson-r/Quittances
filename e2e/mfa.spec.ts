import { test, expect } from '@playwright/test'
import { confirmedUser, enrollSecondFactor, freshTotp, makeMember, signIn } from './support/auth'

test('administrateur : activation du second facteur, codes de secours, puis vérification à chaque connexion', async ({ page }) => {
  const email = await confirmedUser(page)
  await makeMember(email, 'administrator')

  // Sans second facteur, l'espace est fermé.
  await page.goto('/espace')
  const { secret, code, recoveryCodes } = await enrollSecondFactor(page)
  expect(recoveryCodes).toHaveLength(10)
  for (const c of recoveryCodes) expect(c).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/)

  await page.getByRole('link', { name: /continuer/ }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Bonjour Alice' })).toBeVisible()

  // Nouvelle connexion : le second facteur est redemandé.
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await signIn(page, email)
  await expect(page).toHaveURL(/\/securite\/verification/)

  await page.goto('/espace')
  await expect(page).toHaveURL(/\/securite\/verification/)

  await page.getByLabel('Code à 6 chiffres').fill('000000')
  await page.getByRole('button', { name: 'Valider' }).click()
  await expect(page.getByText('incorrect ou expiré')).toBeVisible()

  await page.getByLabel('Code à 6 chiffres').fill(await freshTotp(secret, code))
  await page.getByRole('button', { name: 'Valider' }).click()
  await expect(page).toHaveURL(/\/espace$/)
})

test('le gestionnaire est soumis à la même règle', async ({ page }) => {
  const email = await confirmedUser(page)
  await makeMember(email, 'manager')
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/securite\/activation/)
})

test('le lecteur n\'a pas de second facteur à activer', async ({ page }) => {
  const email = await confirmedUser(page)
  await makeMember(email, 'reader')
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Bonjour Alice' })).toBeVisible()
})

test('code de secours : il remplace le facteur perdu et ne sert qu\'une fois', async ({ page }) => {
  const email = await confirmedUser(page)
  await makeMember(email, 'administrator')
  await page.goto('/espace')
  const first = await enrollSecondFactor(page)
  await page.getByRole('link', { name: /continuer/ }).click()
  await page.getByRole('button', { name: 'Se déconnecter' }).click()

  await signIn(page, email)
  await expect(page).toHaveURL(/\/securite\/verification/)
  await page.getByRole('link', { name: "Je n'ai plus accès à mon application" }).click()

  await page.getByLabel('Code de secours').fill('0000-0000-0000-0000')
  await page.getByRole('button', { name: 'Utiliser ce code' }).click()
  await expect(page.getByText('incorrect ou déjà utilisé')).toBeVisible()

  await page.getByLabel('Code de secours').fill(first.recoveryCodes[0].toUpperCase())
  await page.getByRole('button', { name: 'Utiliser ce code' }).click()
  await expect(page).toHaveURL(/\/securite\/activation\?secours=1/)
  await expect(page.getByText('ancien second facteur a été supprimé')).toBeVisible()

  // Tant qu'un nouveau facteur n'est pas activé, l'espace reste fermé.
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/securite\/activation/)

  const second = await enrollSecondFactor(page)
  expect(second.secret).not.toBe(first.secret)
  expect(second.recoveryCodes.some((c) => first.recoveryCodes.includes(c))).toBe(false)
  await page.getByRole('link', { name: /continuer/ }).click()
  await expect(page).toHaveURL(/\/espace$/)

  // L'ancien code de secours, déjà consommé puis remplacé, ne marche plus.
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await signIn(page, email)
  await expect(page).toHaveURL(/\/securite\/verification/)
  await page.goto('/securite/secours')
  await page.getByLabel('Code de secours').fill(first.recoveryCodes[1])
  await page.getByRole('button', { name: 'Utiliser ce code' }).click()
  await expect(page.getByText('incorrect ou déjà utilisé')).toBeVisible()
})

test('page Sécurité : de nouveaux codes remplacent les anciens', async ({ page }) => {
  const email = await confirmedUser(page)
  await makeMember(email, 'administrator')
  await page.goto('/espace')
  await enrollSecondFactor(page)
  await page.getByRole('link', { name: /continuer/ }).click()

  await page.goto('/securite')
  await page.getByRole('button', { name: 'Générer de nouveaux codes de secours' }).click()
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10)
})
