import { test, expect, type Browser, type Page } from '@playwright/test'
import { adminWithStructure, confirmedUser, unique } from './support/auth'

const BASE_URL = 'http://127.0.0.1:3000'

async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL })
  return context.newPage()
}

/** L'administrateur crée une invitation depuis la page des membres et renvoie le lien affiché. */
async function inviteFromPage(page: Page, email: string, roleLabel: string) {
  await page.getByLabel('Adresse e-mail de la personne invitée').fill(email)
  await page.getByLabel('Rôle', { exact: true }).selectOption({ label: roleLabel })
  await page.getByRole('button', { name: "Créer l'invitation" }).click()
  const link = page.getByTestId('invitation-link').first()
  await expect(link).toBeVisible()
  return link.inputValue()
}

async function openMembers(page: Page) {
  await page.getByRole('link', { name: 'Gérer les membres' }).click()
  await expect(page.getByRole('heading', { name: /Membres de/ })).toBeVisible()
}

async function acceptInvitation(page: Page, link: string) {
  await page.goto(link)
  await page.getByRole('button', { name: "Accepter l'invitation" }).click()
}

test('invitation d\'un membre : lien privé, adresse vérifiée, rôle appliqué', async ({ page, browser }) => {
  const admin = await adminWithStructure(page)
  await openMembers(page)
  await expect(page.getByTestId('member')).toHaveCount(1)

  const inviteeEmail = unique()
  const link = await inviteFromPage(page, inviteeEmail, 'Lecteur')
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3000\/invitation\/[0-9a-f]{64}$/)
  await expect(page.getByTestId('pending-invitation')).toContainText(inviteeEmail)

  const invitee = await newVisitor(browser)
  await confirmedUser(invitee, inviteeEmail)
  await acceptInvitation(invitee, link)
  await expect(invitee).toHaveURL(/\/espace$/)
  await expect(invitee.getByTestId('my-structure')).toContainText('Structure E2E')
  await expect(invitee.getByTestId('my-structure')).toContainText('Lecteur')
  // Le lecteur n'a pas accès à la gestion des membres.
  await expect(invitee.getByRole('link', { name: 'Gérer les membres' })).toHaveCount(0)
  await invitee.goto(`/espace/${admin.entityId}/membres`)
  await expect(invitee.getByRole('heading', { name: '404' })).toBeVisible()

  // Le lien est consommé : il ne marche plus.
  await acceptInvitation(invitee, link)
  await expect(invitee.getByRole('alert').filter({ hasText: 'Lien invalide ou expiré.' })).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('member')).toHaveCount(2)
  await expect(page.getByTestId('member').filter({ hasText: inviteeEmail })).toContainText('Lecteur · Actif')
  await expect(page.getByTestId('pending-invitation')).toHaveCount(0)
})

test('le lien est refusé à un compte dont l\'adresse vérifiée diffère', async ({ page, browser }) => {
  await adminWithStructure(page)
  await openMembers(page)
  const link = await inviteFromPage(page, unique(), 'Gestionnaire')

  const stranger = await newVisitor(browser)
  await confirmedUser(stranger)
  await acceptInvitation(stranger, link)
  await expect(stranger.getByRole('alert').filter({ hasText: 'Lien invalide ou expiré.' })).toBeVisible()
  await stranger.goto('/espace')
  await expect(stranger.getByTestId('my-structure')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('pending-invitation')).toHaveCount(1)
})

test('un visiteur sans compte est renvoyé vers la connexion puis vers l\'invitation', async ({ page, browser }) => {
  await adminWithStructure(page)
  await openMembers(page)
  const inviteeEmail = unique()
  const link = await inviteFromPage(page, inviteeEmail, 'Lecteur')
  const path = new URL(link).pathname

  const visitor = await newVisitor(browser)
  await visitor.goto(path)
  await expect(visitor).toHaveURL(new RegExp(`/connexion\\?next=${encodeURIComponent(path).replaceAll('%2F', '%2F')}`))
})

test('révoquer ou régénérer une invitation invalide l\'ancien lien', async ({ page, browser }) => {
  await adminWithStructure(page)
  await openMembers(page)
  const inviteeEmail = unique()
  const first = await inviteFromPage(page, inviteeEmail, 'Lecteur')

  await page.getByRole('button', { name: `Régénérer l'invitation de ${inviteeEmail}` }).click()
  const second = await page.getByTestId('pending-invitation').getByTestId('invitation-link').inputValue()
  expect(second).not.toBe(first)

  const invitee = await newVisitor(browser)
  await confirmedUser(invitee, inviteeEmail)
  await acceptInvitation(invitee, first)
  await expect(invitee.getByRole('alert').filter({ hasText: 'Lien invalide ou expiré.' })).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: `Révoquer l'invitation de ${inviteeEmail}` }).click()
  await expect(page.getByText('Invitation révoquée.')).toBeVisible()
  await acceptInvitation(invitee, second)
  await expect(invitee.getByRole('alert').filter({ hasText: 'Lien invalide ou expiré.' })).toBeVisible()
})

test('changer le rôle, suspendre, réactiver ; le dernier administrateur est protégé', async ({ page, browser }) => {
  const admin = await adminWithStructure(page)
  await openMembers(page)
  const memberEmail = unique()
  const link = await inviteFromPage(page, memberEmail, 'Gestionnaire')

  const member = await newVisitor(browser)
  await confirmedUser(member, memberEmail)
  await acceptInvitation(member, link)
  await expect(member).toHaveURL(/\/securite\/activation/) // un gestionnaire doit activer son second facteur

  await page.reload()
  const row = page.getByTestId('member').filter({ hasText: memberEmail })
  await row.getByLabel(/Rôle de/).selectOption({ label: 'Lecteur' })
  await row.getByRole('button', { name: /Enregistrer le rôle/ }).click()
  await expect(row.getByText('Rôle modifié.')).toBeVisible()
  await expect(row).toContainText('Lecteur')

  // Devenu lecteur, plus de second facteur exigé : l'espace s'ouvre.
  await member.goto('/espace')
  await expect(member.getByTestId('my-structure')).toContainText('Lecteur')

  await row.getByRole('button', { name: /^Suspendre/ }).click()
  await expect(row.getByText('Membre suspendu.')).toBeVisible()
  await member.goto('/espace')
  await expect(member.getByTestId('my-structure')).toHaveCount(0)

  await row.getByRole('button', { name: /^Réactiver/ }).click()
  await expect(row.getByText('Membre réactivé.')).toBeVisible()
  await member.goto('/espace')
  await expect(member.getByTestId('my-structure')).toHaveCount(1)

  // Le seul administrateur ne peut ni se rétrograder ni se suspendre.
  const self = page.getByTestId('member').filter({ hasText: admin.email })
  await self.getByLabel(/Rôle de/).selectOption({ label: 'Lecteur' })
  await self.getByRole('button', { name: /Enregistrer le rôle/ }).click()
  await expect(self.getByRole('alert')).toContainText('au moins un administrateur actif')
  await self.getByRole('button', { name: /^Suspendre/ }).click()
  await expect(self.getByRole('alert')).toContainText('au moins un administrateur actif')
})
