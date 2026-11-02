import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDestructive, findHistoryChanges } from './check-migrations.mjs'

const f = (sql) => findDestructive('m.sql', sql)

test('une migration sans opération destructive passe', () => {
  assert.deepEqual(f('create table a (id int);\nalter table a add column b int;'), [])
})

test('DROP, RENAME et TRUNCATE sont refusés', () => {
  assert.equal(f('drop table a;').length, 1)
  assert.equal(f('ALTER TABLE a DROP COLUMN b;').length, 1)
  assert.equal(f('alter table a rename to c;').length, 1)
  assert.equal(f('alter table a rename column b to c;').length, 1)
  assert.equal(f('truncate a;').length, 1)
  assert.equal(f('truncate table a;').length, 1)
})

test('la casse et les espaces multiples ne contournent pas le contrôle', () => {
  assert.equal(f('DrOp   TABLE a;').length, 1)
  assert.equal(f('alter table a\n  drop column b;').length, 1)
})

test('une annotation avec motif sur la ligne précédente autorise', () => {
  assert.deepEqual(f('-- allow-destructive: remplacée par la table b\ndrop table a;'), [])
})

test('une annotation sur la même ligne autorise', () => {
  assert.deepEqual(f('drop table a; -- allow-destructive: table temporaire'), [])
})

test('une annotation sans motif ne suffit pas', () => {
  assert.equal(f('-- allow-destructive:\ndrop table a;').length, 1)
  assert.equal(f('-- allow-destructive\ndrop table a;').length, 1)
})

test('une annotation séparée de la ligne par une autre ligne ne suffit pas', () => {
  assert.equal(f('-- allow-destructive: motif\n\ndrop table a;').length, 1)
})

test('un mot dans un commentaire ou une chaîne ne déclenche pas le contrôle', () => {
  assert.deepEqual(f("-- on ne fait pas de drop table ici\nselect 'drop table a';"), [])
  assert.deepEqual(f("comment on table a is 'rename later';"), [])
})

test('le résultat indique le fichier, la ligne et la règle', () => {
  const [r] = findDestructive('x.sql', 'select 1;\ntruncate a;')
  assert.equal(r.file, 'x.sql')
  assert.equal(r.line, 2)
  assert.match(r.rule, /TRUNCATE/)
})

test('une migration existante modifiée, supprimée ou renommée est refusée', () => {
  const diff = ['A\tsupabase/migrations/2_new.sql', 'M\tsupabase/migrations/1_old.sql', 'D\tsupabase/migrations/0_gone.sql', 'R100\tsupabase/migrations/3_a.sql\tsupabase/migrations/3_b.sql'].join('\n')
  const r = findHistoryChanges(diff)
  assert.deepEqual(r.map((x) => x.file), ['supabase/migrations/1_old.sql', 'supabase/migrations/0_gone.sql', 'supabase/migrations/3_a.sql'])
})

test('l\'ajout d\'une migration seule passe', () => {
  assert.deepEqual(findHistoryChanges('A\tsupabase/migrations/2_new.sql\n'), [])
})
