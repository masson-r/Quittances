import { test, expect } from '@playwright/test'
import { confirmationLink } from './support/mail'
import { operatorQuery } from './support/db'
import { PASSWORD, confirmedUser, signIn, signOut, signUp, unique } from './support/auth'

const NEW_PASSWORD = 'NouveauMotDePasse2027!'

test('inscription, confirmation par e-mail, déconnexion puis connexion', async ({ page }) => {
  const email = await confirmedUser(page)
  await expect(page.getByRole('heading', { name: 'Bonjour Alice' })).toBeVisible()
  await expect(page.getByTestId('current-user')).toHaveText('Alice Martin')

  await signOut(page)

  await signIn(page, email)
  await expect(page).toHaveURL(/\/espace$/)
})

test('un compte non confirmé ne peut pas se connecter', async ({ page }) => {
  const email = unique()
  await signUp(page, email)
  await page.goto('/connexion')
  await signIn(page, email)
  await expect(page.locator('main [role="alert"]')).toContainText("Confirmez d'abord votre adresse e-mail")
  await expect(page).toHaveURL(/\/connexion/)
})

test('mauvais mot de passe : message unique, sans révéler si le compte existe', async ({ page }) => {
  await page.goto('/connexion')
  await signIn(page, unique(), 'MauvaisMotDePasse1')
  await expect(page.locator('main [role="alert"]')).toHaveText('Adresse e-mail ou mot de passe incorrect.')
})

test('l\'espace propriétaire exige une connexion, puis ramène à la page demandée', async ({ page }) => {
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/connexion\?next=%2Fespace$/)

  const email = unique()
  await signUp(page, email)
  await page.goto(await confirmationLink(email))
  await signOut(page)

  await page.goto('/espace')
  await expect(page).toHaveURL(/\/connexion/)
  await signIn(page, email)
  await expect(page).toHaveURL(/\/espace$/)
})

test('le paramètre next ne permet pas de quitter le site', async ({ page }) => {
  const email = await confirmedUser(page)
  await signOut(page)
  await page.goto('/connexion?next=//pirate.example')
  await signIn(page, email)
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/espace$/)
})

test('réinitialisation du mot de passe', async ({ page }) => {
  const email = await confirmedUser(page)
  await signOut(page)

  await page.goto('/mot-de-passe-oublie')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByRole('button', { name: 'Envoyer le lien' }).click()
  await expect(page.getByRole('status')).toContainText("Si un compte existe")

  await page.goto(await confirmationLink(email, 'recovery'))
  await expect(page).toHaveURL(/\/mot-de-passe\/nouveau$/)

  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD)
  await page.getByLabel('Confirmez le mot de passe').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)

  await signOut(page)
  await signIn(page, email, PASSWORD)
  await expect(page.locator('main [role="alert"]')).toContainText('incorrect')
  await signIn(page, email, NEW_PASSWORD)
  await expect(page).toHaveURL(/\/espace$/)
})

test('un mot de passe trop faible est refusé avec un message en français', async ({ page }) => {
  await page.goto('/inscription')
  await page.getByLabel('Prénom').fill('Alice')
  await page.getByLabel('Nom', { exact: true }).fill('Martin')
  await page.getByLabel('Adresse e-mail').fill(unique())
  await page.getByLabel('Mot de passe', { exact: true }).fill('court')
  await page.getByLabel('Confirmez le mot de passe').fill('court')
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByText('au moins 12 caractères', { exact: false }).first()).toBeVisible()
})

test('un profil désactivé est refusé à la requête suivante puis à la reconnexion', async ({ page }) => {
  const email = await confirmedUser(page)
  await operatorQuery("update public.profiles set status = 'disabled' where email = $1", [email])

  await page.goto('/espace')
  await expect(page).toHaveURL(/\/connexion/)

  await page.goto('/connexion')
  await signIn(page, email)
  await expect(page.locator('main [role="alert"]')).toContainText('désactivé')

  await operatorQuery("update public.profiles set status = 'active' where email = $1", [email])
  await page.goto('/connexion')
  await signIn(page, email)
  await expect(page).toHaveURL(/\/espace$/)
})
