import { test, expect } from '@playwright/test'

test('la page d\'accueil s\'affiche en français', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Loyo-reg')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
})
