import { test, expect } from '@playwright/test'
import { crc32 } from 'node:zlib'
import { adminWithStructure, confirmedUser, makeMember, waitForForms } from './support/auth'
import { blockingViolations } from './support/axe'
import { operatorQuery } from './support/db'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/** PNG avec un bloc eXIf inséré après l'en-tête : les métadonnées doivent disparaître à l'enregistrement. */
function pngWithExif(): Buffer {
  const data = Buffer.from('GPS-secret')
  const type = Buffer.from('eXIf')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  const chunk = Buffer.concat([length, type, data, crc])
  const afterIhdr = 8 + 25
  return Buffer.concat([TINY_PNG.subarray(0, afterIhdr), chunk, TINY_PNG.subarray(afterIhdr)])
}

test('signature : téléversement sans métadonnées, remplacement, retrait, fichier refusé', async ({ page }) => {
  const main = page.getByRole('main')
  const admin = await adminWithStructure(page)
  await page.goto(`/espace/${admin.entityId}/ma-signature`)
  await waitForForms(page)
  await expect(main.getByTestId('no-signature')).toBeVisible()
  expect(await blockingViolations(page)).toEqual([])

  // Un fichier qui n'est pas une image est refusé, quel que soit son nom.
  await main.getByLabel('Image de signature').setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: Buffer.from('pas une image') })
  await main.getByRole('button', { name: 'Enregistrer la signature' }).click()
  await expect(main.getByRole('alert')).toContainText('PNG ou JPEG')

  await main.getByLabel('Image de signature').setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: pngWithExif() })
  await main.getByRole('button', { name: 'Enregistrer la signature' }).click()
  await expect(main.getByTestId('signature-preview')).toBeVisible()
  await expect(main.getByTestId('no-signature')).toHaveCount(0)
  expect(await blockingViolations(page)).toEqual([])

  const stored = await operatorQuery(
    "select content_type, active, position('\\x47505320'::bytea in image) as exif_pos, position(decode('65584966', 'hex') in image) as exif_chunk, sha256 = encode(sha256(image), 'hex') as hashed from public.member_signatures where entity_id = $1",
    [admin.entityId],
  )
  expect(stored.rows).toHaveLength(1)
  expect(stored.rows[0]).toMatchObject({ content_type: 'image/png', active: true, exif_chunk: 0, hashed: true })

  // Remplacement : l'ancienne est conservée mais inactive.
  await waitForForms(page)
  await main.getByLabel('Nouvelle image de signature').setInputFiles({ name: 'autre.png', mimeType: 'image/png', buffer: TINY_PNG })
  await main.getByRole('button', { name: 'Remplacer la signature' }).click()
  await expect
    .poll(async () => (await operatorQuery('select active from public.member_signatures where entity_id = $1 order by created_at', [admin.entityId])).rows.map((r) => r.active))
    .toEqual([false, true])

  await main.getByRole('button', { name: 'Retirer ma signature' }).click()
  await expect(main.getByTestId('no-signature')).toBeVisible()
  const kept = await operatorQuery('select count(*)::int as n, count(*) filter (where active)::int as active from public.member_signatures where entity_id = $1', [admin.entityId])
  expect(kept.rows[0]).toEqual({ n: 2, active: 0 })
})

test('signature : le lecteur n\'y a pas accès', async ({ page }) => {
  const email = await confirmedUser(page)
  const entityId = await makeMember(email, 'reader')
  await page.goto(`/espace/${entityId}/ma-signature`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
