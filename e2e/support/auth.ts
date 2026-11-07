import { expect, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { confirmationLink } from './mail'
import { operatorQuery } from './db'

export const PASSWORD = 'MotDePasse2026!'

export const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`

export async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto('/inscription')
  await page.getByLabel('Prénom').fill('Alice')
  await page.getByLabel('Nom', { exact: true }).fill('Martin')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByLabel('Confirmez le mot de passe').fill(password)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByRole('status')).toContainText('message de confirmation')
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/** Compte créé, confirmé et connecté (sans structure : aucun second facteur exigé). */
export async function confirmedUser(page: Page, email = unique()) {
  await signUp(page, email)
  await page.goto(await confirmationLink(email))
  await expect(page).toHaveURL(/\/espace$/)
  return email
}

/** Donne un rôle de membre à un compte, dans une structure créée pour l'occasion (action de l'opérateur). */
export async function makeMember(email: string, role: 'administrator' | 'manager' | 'reader'): Promise<string> {
  const entity = await operatorQuery("insert into public.ownership_entities (name, kind) values ('Structure E2E', 'sci') returning id")
  await operatorQuery(
    'insert into public.entity_memberships (entity_id, profile_id, role) select $1, id, $2 from public.profiles where email = $3',
    [entity.rows[0].id, role, email],
  )
  return entity.rows[0].id as string
}

/** Administrateur d'une nouvelle structure, second facteur activé, connecté (session aal2). */
export async function adminWithStructure(page: Page) {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'administrator')
  await page.goto('/espace')
  const factor = await enrollSecondFactor(page)
  await page.getByRole('link', { name: /continuer/ }).click()
  await expect(page).toHaveURL(/\/espace$/)
  return { email, entityId, ...factor }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Code TOTP (RFC 6238 : SHA-1, pas de 30 s, 6 chiffres) pour un secret en base 32. */
export function totp(secret: string, at = Date.now()): string {
  const clean = secret.replace(/[\s=]/g, '').toUpperCase()
  let bits = ''
  for (const ch of clean) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const hmac = createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString()
  return code.padStart(6, '0')
}

/** Attend le pas suivant si le code courant a déjà servi, pour ne pas rejouer un code. */
export async function freshTotp(secret: string, previous?: string): Promise<string> {
  let code = totp(secret)
  while (code === previous) {
    await new Promise((r) => setTimeout(r, 1000))
    code = totp(secret)
  }
  return code
}

/** Active le second facteur depuis la page d'activation ; renvoie le secret et les codes de secours. */
export async function enrollSecondFactor(page: Page) {
  await expect(page).toHaveURL(/\/securite\/activation/)
  // Le clic peut précéder l'hydratation de la page : on le répète jusqu'à l'apparition du QR code.
  await expect(async () => {
    await page.getByRole('button', { name: 'Commencer' }).click()
    await expect(page.getByTestId('totp-secret')).toBeVisible({ timeout: 4000 })
  }).toPass({ timeout: 30_000 })
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim()
  const code = await freshTotp(secret)
  await page.getByLabel('Code à 6 chiffres').fill(code)
  await page.getByRole('button', { name: 'Activer le second facteur' }).click()
  await expect(page.getByTestId('recovery-codes')).toBeVisible()
  const recoveryCodes = await page.getByTestId('recovery-codes').locator('li').allTextContents()
  return { secret, code, recoveryCodes }
}
