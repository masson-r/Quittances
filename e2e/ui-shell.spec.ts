import { test, expect, type Page } from '@playwright/test'
import { blockingViolations } from './support/axe'
import { adminWithStructure, confirmedUser, makeMember } from './support/auth'

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }
const MENU = 'Navigation principale'

async function hasHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
}

for (const [name, viewport] of [
  ['bureau', DESKTOP],
  ['mobile 390 px', MOBILE],
] as const) {
  test.describe(`accessibilité et mise en page — ${name}`, () => {
    test.use({ viewport })

    test('pages publiques : aucune violation critique, pas de défilement horizontal', async ({ page }) => {
      for (const path of ['/', '/connexion', '/inscription', '/mot-de-passe-oublie']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await blockingViolations(page), path).toEqual([])
        expect(await hasHorizontalScroll(page), `${path} défile horizontalement`).toBe(false)
      }
    })

    test("espace de la structure : menu, pages et sécurité sans violation critique", async ({ page }) => {
      const admin = await adminWithStructure(page)
      const base = `/espace/${admin.entityId}`
      const paths = ['/espace', `${base}/tableau-de-bord`, `${base}/biens`, `${base}/paiements`, `${base}/membres`, '/securite']
      for (const path of paths) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await blockingViolations(page), path).toEqual([])
        expect(await hasHorizontalScroll(page), `${path} défile horizontalement`).toBe(false)
      }
    })
  })
}

test.describe("navigation de l'espace propriétaire", () => {
  test('bureau : menu toujours visible, section active signalée, pas de sélecteur avec une seule structure', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    const admin = await adminWithStructure(page)
    await page.goto(`/espace/${admin.entityId}`)
    await expect(page).toHaveURL(/\/tableau-de-bord$/)

    const menu = page.getByRole('navigation', { name: MENU })
    for (const label of ['Tableau de bord', 'Biens', 'Locataires', 'Baux', 'Échéances et paiements', 'Quittances', 'Dépenses', 'Membres']) {
      await expect(menu.getByRole('link', { name: label })).toBeVisible()
    }
    await expect(menu.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden()
    await expect(page.getByLabel('Structure')).toHaveCount(0)

    await menu.getByRole('link', { name: 'Biens' }).click()
    await expect(page.getByRole('heading', { name: 'Biens', level: 1 })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Biens' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Cette section sera disponible prochainement.').filter({ visible: true })).toHaveCount(1)
  })

  test('mobile : le menu se replie derrière un bouton et se referme après un choix', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const admin = await adminWithStructure(page)
    await page.goto(`/espace/${admin.entityId}/tableau-de-bord`)

    const toggle = page.getByRole('button', { name: 'Menu' })
    const menu = page.getByRole('navigation', { name: MENU })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeHidden()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await menu.getByRole('link', { name: 'Locataires' }).click()
    await expect(page.getByRole('heading', { name: 'Locataires', level: 1 })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeHidden()
  })

  test('le lecteur ne voit que les sections qu’il peut lire', async ({ page }) => {
    const email = await confirmedUser(page)
    const entityId = await makeMember(email, 'reader')
    await page.setViewportSize(DESKTOP)
    await page.goto(`/espace/${entityId}/tableau-de-bord`)
    const menu = page.getByRole('navigation', { name: MENU })
    await expect(menu.getByRole('link', { name: 'Biens' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Membres' })).toHaveCount(0)

    await page.goto(`/espace/${entityId}/membres`)
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  })

  test('plusieurs structures : le sélecteur change de structure en gardant la section', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    const email = await confirmedUser(page)
    const first = await makeMember(email, 'reader')
    const second = await makeMember(email, 'reader')
    await page.goto(`/espace/${first}/biens`)

    // Next conserve la page quittée (masquée) : on ne regarde que le sélecteur visible.
    const selector = page.locator('select:visible')
    await expect(selector).toHaveValue(first)
    await selector.selectOption(second)
    await expect(page).toHaveURL(new RegExp(`/espace/${second}/biens$`))
    await expect(page.locator('select:visible')).toHaveValue(second)
  })

  test("une structure dont on n’est pas membre est introuvable", async ({ page }) => {
    const email = await confirmedUser(page)
    await makeMember(email, 'reader')
    const foreign = await makeMember(`inconnu-${email}`, 'reader')
    await page.goto(`/espace/${foreign}/tableau-de-bord`)
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  })

  test("lien d’évitement vers le contenu", async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await confirmedUser(page)
    await page.goto('/espace')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Aller au contenu' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
  })
})
