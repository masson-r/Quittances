import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = {
  a: '00000000-0000-4000-8000-0000000000c1',
  b: '00000000-0000-4000-8000-0000000000c2',
}
const T = {
  a: '00000000-0000-4000-8000-0000000000c3',
  b: '00000000-0000-4000-8000-0000000000c4',
}

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    const ids = [P.a, P.b, E.A, E.B, T.a, T.b, U.adminA]
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $3, 'Appartement A'), ($2, $4, 'Appartement B')", ids.slice(0, 4))
    await c.query("insert into public.tenants (id, entity_id, last_name, first_name) values ($3, $1, 'Martin', 'Alice'), ($4, $2, 'Durand', 'Paul')", [E.A, E.B, T.a, T.b])
    await c.query("insert into public.tenant_private_details (tenant_id, entity_id, guarantor_kind, guarantor_name) values ($3, $1, 'person', 'Garant A'), ($4, $2, 'person', 'Garant B')", [E.A, E.B, T.a, T.b])
    await c.query("insert into public.property_access_codes (entity_id, property_id, label, code) values ($3, $1, 'Portail', '4821'), ($4, $2, 'Portail', '9999')", [P.a, P.b, E.A, E.B])
    await c.query("insert into public.property_maintenance_notes (entity_id, property_id, body, author_id) values ($1, $2, 'Chaudière révisée', $3)", [E.A, P.a, U.adminA])
    await fn(c)
  })

const count = async (c: pg.Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows.length

/** Vrai si l'instruction échoue ou ne touche aucune ligne. */
const blocked = async (c: pg.Client, sql: string, params: unknown[] = []) => {
  await c.query('savepoint essai')
  try {
    const res = await c.query(sql, params)
    await c.query('release savepoint essai')
    return res.rowCount === 0
  } catch {
    await c.query('rollback to savepoint essai')
    return true
  }
}

describe('biens', () => {
  it('administrateur et gestionnaire lisent, créent et modifient ; le lecteur lit seulement', async () => {
    await world(async (c) => {
      for (const user of [U.adminA, U.managerA]) {
        await asUser(c, user)
        expect(await count(c, "select 1 from public.properties where label = 'Appartement A'")).toBe(1)
        expect((await c.query("insert into public.properties (entity_id, label) values ($1, 'Nouveau bien')", [E.A])).rowCount).toBe(1)
        expect((await c.query("update public.properties set description = 'ok' where id = $1", [P.a])).rowCount).toBe(1)
      }
      await asUser(c, U.readerA)
      expect(await count(c, 'select 1 from public.properties')).toBe(3)
      expect(await blocked(c, "insert into public.properties (entity_id, label) values ($1, 'Interdit')", [E.A])).toBe(true)
      expect(await blocked(c, "update public.properties set description = 'x' where id = $1", [P.a])).toBe(true)
    })
  })

  it('cloisonnement : une autre structure, un suspendu et un sans second facteur ne voient rien', async () => {
    await world(async (c) => {
      await asUser(c, U.adminB)
      expect(await count(c, 'select 1 from public.properties')).toBe(1) // le sien seulement
      expect(await blocked(c, "insert into public.properties (entity_id, label) values ($1, 'Intrus')", [E.A])).toBe(true)
      expect(await blocked(c, "update public.properties set label = 'Piraté' where id = $1", [P.a])).toBe(true)
      await asUser(c, U.suspendedA)
      expect(await count(c, 'select 1 from public.properties')).toBe(0)
      await asUser(c, U.adminA, 'aal1')
      expect(await count(c, 'select 1 from public.properties')).toBe(0)
    })
  })

  it('aucune suppression, quel que soit le rôle', async () => {
    await world(async (c) => {
      for (const user of [U.adminA, U.managerA, U.readerA]) {
        await asUser(c, user)
        expect(await blocked(c, 'delete from public.properties where id = $1', [P.a]), user).toBe(true)
      }
    })
  })

  it('référence d\'import unique par structure', async () => {
    await world(async (c) => {
      await c.query("insert into public.properties (entity_id, label, external_ref) values ($1, 'A', 'ref-1'), ($2, 'B', 'ref-1')", [E.A, E.B])
      await expect(c.query("insert into public.properties (entity_id, label, external_ref) values ($1, 'C', 'ref-1')", [E.A])).rejects.toThrow(/unique/)
    })
  })

  it('archivage et restauration tracés', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query('update public.properties set archived_at = now() where id = $1', [P.a])
      await c.query('update public.properties set archived_at = null where id = $1', [P.a])
      await asOwner(c)
      const { rows } = await c.query("select action, subject_id from public.audit_logs where subject_table = 'properties' order by action")
      expect(rows.map((r) => r.action)).toEqual(['property.archived', 'property.restored'])
      expect(rows[0].subject_id).toBe(P.a)
    })
  })
})

describe('notes de maintenance', () => {
  it('lisibles par le lecteur, écrites par administrateur et gestionnaire au nom de leur auteur', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect(await count(c, 'select 1 from public.property_maintenance_notes')).toBe(1)
      expect(await blocked(c, "insert into public.property_maintenance_notes (entity_id, property_id, body) values ($1, $2, 'x')", [E.A, P.a])).toBe(true)

      await asUser(c, U.managerA)
      expect((await c.query("insert into public.property_maintenance_notes (entity_id, property_id, body) values ($1, $2, 'Fuite réparée')", [E.A, P.a])).rowCount).toBe(1)
      const { rows } = await c.query("select author_id, noted_on = public.app_today() as today from public.property_maintenance_notes where body = 'Fuite réparée'")
      expect(rows[0]).toEqual({ author_id: U.managerA, today: true })
      expect(
        await blocked(c, "insert into public.property_maintenance_notes (entity_id, property_id, body, author_id) values ($1, $2, 'Usurpée', $3)", [E.A, P.a, U.adminA]),
      ).toBe(true)
    })
  })

  it('ajout seul : ni modification ni suppression, même pour le propriétaire de la base', async () => {
    await world(async (c) => {
      await expect(c.query("update public.property_maintenance_notes set body = 'autre'")).rejects.toThrow(/ajout seul/)
      await c.query('rollback to savepoint essai').catch(() => {})
    })
    await world(async (c) => {
      await expect(c.query('delete from public.property_maintenance_notes')).rejects.toThrow(/ajout seul/)
    })
  })

  it('une note ne peut viser que le bien de sa propre structure', async () => {
    await world(async (c) => {
      await expect(
        c.query("insert into public.property_maintenance_notes (entity_id, property_id, body) values ($1, $2, 'croisée')", [E.A, P.b]),
      ).rejects.toThrow(/foreign key/)
    })
  })
})

describe('codes d\'accès (champ sensible)', () => {
  it('administrateur et gestionnaire les gèrent ; le lecteur n\'en voit aucun', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect(await count(c, 'select 1 from public.property_access_codes')).toBe(0)
      expect(await blocked(c, "insert into public.property_access_codes (entity_id, property_id, label, code) values ($1, $2, 'x', '1')", [E.A, P.a])).toBe(true)

      await asUser(c, U.managerA)
      expect(await count(c, 'select 1 from public.property_access_codes')).toBe(1)
      expect((await c.query("update public.property_access_codes set code = '5555' where property_id = $1", [P.a])).rowCount).toBe(1)
      expect((await c.query("insert into public.property_access_codes (entity_id, property_id, label, code) values ($1, $2, 'Boîte aux lettres', '7')", [E.A, P.a])).rowCount).toBe(1)
      expect((await c.query("delete from public.property_access_codes where label = 'Boîte aux lettres'")).rowCount).toBe(1)
    })
  })

  it('cloisonnement entre structures', async () => {
    await world(async (c) => {
      await asUser(c, U.adminB)
      expect((await c.query('select code from public.property_access_codes')).rows).toEqual([{ code: '9999' }])
      expect(await blocked(c, "update public.property_access_codes set code = '0' where property_id = $1", [P.a])).toBe(true)
    })
  })

  it('les changements sont tracés sans le code', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query("update public.property_access_codes set code = '1234' where property_id = $1", [P.a])
      await asOwner(c)
      const { rows } = await c.query("select details from public.audit_logs where action = 'property.access_code_changed' and entity_id = $1", [E.A])
      expect(rows.length).toBeGreaterThan(0)
      expect(JSON.stringify(rows)).not.toMatch(/1234|4821/)
    })
  })
})

describe('dossiers locataires', () => {
  it('administrateur et gestionnaire gèrent ; le lecteur lit seulement ; l\'autre structure ne voit rien', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      expect((await c.query("insert into public.tenants (entity_id, last_name) values ($1, 'Nouveau')", [E.A])).rowCount).toBe(1)
      expect((await c.query("update public.tenants set phone = '0102030405' where id = $1", [T.a])).rowCount).toBe(1)

      await asUser(c, U.readerA)
      expect(await count(c, 'select 1 from public.tenants')).toBe(2)
      expect(await blocked(c, "update public.tenants set phone = '0' where id = $1", [T.a])).toBe(true)
      expect(await blocked(c, 'delete from public.tenants where id = $1', [T.a])).toBe(true)

      await asUser(c, U.adminB)
      expect((await c.query('select last_name from public.tenants')).rows).toEqual([{ last_name: 'Durand' }])
      expect(await blocked(c, "update public.tenants set phone = '0' where id = $1", [T.a])).toBe(true)
    })
  })

  it('archivage tracé', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query('update public.tenants set archived_at = now() where id = $1', [T.a])
      await asOwner(c)
      const { rows } = await c.query("select action from public.audit_logs where subject_table = 'tenants'")
      expect(rows).toEqual([{ action: 'tenant.archived' }])
    })
  })
})

describe('données privées du dossier (champ sensible)', () => {
  it('le lecteur ne voit aucune donnée sensible et n\'en crée pas', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect(await count(c, 'select 1 from public.tenant_private_details')).toBe(0)
      await asOwner(c)
      await c.query("insert into public.tenants (id, entity_id, last_name) values ('00000000-0000-4000-8000-0000000000c9', $1, 'Sans fiche')", [E.A])
      await asUser(c, U.readerA)
      expect(
        await blocked(c, "insert into public.tenant_private_details (tenant_id, entity_id) values ('00000000-0000-4000-8000-0000000000c9', $1)", [E.A]),
      ).toBe(true)
    })
  })

  it('administrateur et gestionnaire les lisent et les modifient ; jamais d\'une autre structure', async () => {
    await world(async (c) => {
      for (const user of [U.adminA, U.managerA]) {
        await asUser(c, user)
        expect((await c.query('select guarantor_name from public.tenant_private_details')).rows).toEqual([{ guarantor_name: 'Garant A' }])
        expect((await c.query("update public.tenant_private_details set housing_aid = 'to_tenant' where tenant_id = $1", [T.a])).rowCount).toBe(1)
      }
      expect(await blocked(c, "update public.tenant_private_details set note = 'x' where tenant_id = $1", [T.b])).toBe(true)
    })
  })

  it('valeurs contrôlées, et fiche obligatoirement liée à un dossier de la même structure', async () => {
    await world(async (c) => {
      await expect(c.query("update public.tenant_private_details set guarantor_kind = 'inconnu'")).rejects.toThrow(/check/)
    })
    await world(async (c) => {
      await c.query("insert into public.tenants (id, entity_id, last_name) values ('00000000-0000-4000-8000-0000000000c8', $1, 'Autre')", [E.A])
      await expect(
        c.query("insert into public.tenant_private_details (tenant_id, entity_id) values ('00000000-0000-4000-8000-0000000000c8', $1)", [E.B]),
      ).rejects.toThrow(/foreign key/)
    })
  })

  it('la modification est tracée sans contenu', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query("update public.tenant_private_details set guarantor_name = 'Nom Secret' where tenant_id = $1", [T.a])
      await asOwner(c)
      const { rows } = await c.query("select details from public.audit_logs where action = 'tenant.private_details_changed' and subject_id = $1", [T.a])
      expect(rows.length).toBeGreaterThan(0)
      expect(JSON.stringify(rows)).not.toMatch(/Secret|Garant/)
    })
  })
})

describe('invitation de locataire', () => {
  it('le dossier visé appartient à la même structure', async () => {
    await world(async (c) => {
      await c.query("insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by) values ($1, 'tenant', $2, 'h-ok', $3)", [E.A, T.a, U.adminA])
      await expect(
        c.query("insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by) values ($1, 'tenant', $2, 'h-ko', $3)", [E.A, T.b, U.adminA]),
      ).rejects.toThrow(/foreign key/)
    })
  })
})

describe('lots d\'import', () => {
  it('visibles de l\'administrateur seul, jamais modifiables par un utilisateur', async () => {
    await world(async (c) => {
      await c.query("insert into public.import_batches (entity_id, files_sha256) values ($1, 'abc')", [E.A])
      await asUser(c, U.adminA)
      expect(await count(c, 'select 1 from public.import_batches')).toBe(1)
      expect(await blocked(c, "insert into public.import_batches (entity_id) values ($1)", [E.A])).toBe(true)
      expect(await blocked(c, "update public.import_batches set status = 'cancelled'")).toBe(true)
      await asUser(c, U.managerA)
      expect(await count(c, 'select 1 from public.import_batches')).toBe(0)
      await asUser(c, U.adminB)
      expect(await count(c, 'select 1 from public.import_batches')).toBe(0)
    })
  })
})
