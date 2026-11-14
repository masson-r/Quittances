import { describe, expect, it } from 'vitest'
import { buildPayload, euros, formatReport, parseAmount, parseArgs, parseBool, parseCsv, parseDate, UsageError, type Report } from './import-history-lib'

const files = {
  biens: 'ref;libelle;adresse;code_postal;ville\nBIEN-A;Appartement A;1 rue des Lilas;75001;Paris\n',
  locataires: 'ref;nom;prenom;email;telephone\nLOC-1;Durand;Alice;;\nLOC-2;Martin;Bob;;\n',
  baux: 'ref;bien;debut;fin;jour_echeance;depot\nBAIL-A;BIEN-A;01/03/2021;;5;650,00\n',
  conditions: 'bail;a_partir_du;loyer;charges\nBAIL-A;2023-03-01;640;60\nBAIL-A;2021-03-01;600;50\n',
  colocataires: 'bail;locataire;du;au\nBAIL-A;LOC-1;;\nBAIL-A;LOC-2;2022-01-01;\n',
  paiements: 'ref;bail;date;montant;mode;reference;periode\nP1;BAIL-A;2021-03-04;650,00;Virement;VIR1;2021-03\nP2;BAIL-A;2021-04-04;650;chèque;;\n',
  depenses: 'ref;bien;date;categorie;description;montant;recuperable\nD1;BIEN-A;2022-06-15;Travaux;Peinture;1 200,00;oui\n',
  apurements: 'ref;bail;date;montant;mode;motif;final\nA1;BAIL-A;2024-09-15;120;virement;Régularisation;non\n',
}

describe('parseCsv', () => {
  it('détecte « ; » ou « , », ignore le BOM, gère les guillemets et les retours à la ligne', () => {
    const semi = parseCsv('﻿ref;libelle\nA;"Un ; deux"\n"B";"ligne\nsuite"\n')
    expect(semi.header).toEqual(['ref', 'libelle'])
    expect(semi.rows.map((r) => r.values.libelle)).toEqual(['Un ; deux', 'ligne\nsuite'])
    const comma = parseCsv('ref,libelle\r\nA,"Il dit ""oui"""\r\n')
    expect(comma.rows[0].values.libelle).toBe('Il dit "oui"')
  })

  it('numérote les lignes d\'après le fichier et saute les lignes vides', () => {
    const { rows } = parseCsv('ref;x\nA;1\n\nB;2\n')
    expect(rows.map((r) => [r.values.ref, r.line])).toEqual([['A', 2], ['B', 4]])
  })
})

describe('valeurs', () => {
  it('dates', () => {
    expect(parseDate('2026-03-15')).toBe('2026-03-15')
    expect(parseDate('5/3/2026')).toBe('2026-03-05')
    expect(parseDate('30/02/2026')).toBeNull()
    expect(parseDate('demain')).toBeNull()
  })
  it('montants en centimes', () => {
    expect(parseAmount('850')).toBe(85000)
    expect(parseAmount('1 250,5')).toBe(125050)
    expect(parseAmount('850.50 €')).toBe(85050)
    expect(parseAmount('-15,00')).toBe(-1500)
    expect(parseAmount('12,345')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(euros(-125050)).toBe('-1 250,50 €')
  })
  it('booléens', () => {
    expect([parseBool('oui'), parseBool('Non'), parseBool(''), parseBool('peut-être')]).toEqual([true, false, false, null])
  })
})

describe('buildPayload', () => {
  it('construit le lot : conditions triées, colocataires, modes français, montants en centimes', () => {
    const { payload, errors } = buildPayload(files)
    expect(errors).toEqual([])
    expect(payload.leases[0]).toMatchObject({ ref: 'BAIL-A', start_date: '2021-03-01', end_date: null, due_day: 5, deposit_cents: 65000 })
    expect((payload.leases[0].terms as { effective_from: string }[]).map((t) => t.effective_from)).toEqual(['2021-03-01', '2023-03-01'])
    expect(payload.leases[0].tenants).toHaveLength(2)
    expect(payload.payments.map((p) => [p.mode, p.amount_cents, p.period_start])).toEqual([['transfer', 65000, '2021-03-01'], ['cheque', 65000, null]])
    expect(payload.expenses[0]).toMatchObject({ amount_cents: 120000, recoverable: true })
    expect(payload.settlements[0]).toMatchObject({ amount_cents: 12000, is_final: false })
  })

  it('les fichiers facultatifs peuvent manquer', () => {
    const { errors } = buildPayload({ biens: files.biens, locataires: files.locataires, baux: files.baux, conditions: files.conditions, colocataires: files.colocataires })
    expect(errors).toEqual([])
  })

  it('signale fichiers et colonnes manquants', () => {
    const { errors } = buildPayload({ ...files, baux: undefined, biens: 'ref;nom\nA;x\n' })
    expect(errors).toContainEqual({ file: 'baux', line: 0, message: 'Fichier baux.csv manquant' })
    expect(errors).toContainEqual({ file: 'biens', line: 1, message: 'Colonne(s) manquante(s) : libelle' })
  })

  it('localise chaque erreur de format avec fichier et numéro de ligne', () => {
    const { errors } = buildPayload({
      ...files,
      paiements: 'ref;bail;date;montant;mode\nP1;BAIL-A;2021-02-30;650;virement\nP2;BAIL-A;2021-03-01;0;virement\nP3;BAIL-A;2021-03-01;650;troc\nP1;BAIL-A;2021-03-01;650;virement\n',
      depenses: 'ref;bien;date;categorie;description;montant;recuperable\nD1;BIEN-A;2022-06-15;Travaux;Peinture;12,345;oui\n',
    })
    expect(errors.map((e) => [e.file, e.line])).toEqual([['paiements', 2], ['paiements', 3], ['paiements', 4], ['paiements', 5], ['depenses', 2]])
    expect(errors[0].message).toContain('date invalide')
    expect(errors[3].message).toContain('double')
  })

  it('un bail référencé par conditions ou colocataires doit exister', () => {
    const { errors } = buildPayload({ ...files, conditions: files.conditions + 'BAIL-X;2021-03-01;500;0\n' })
    expect(errors).toContainEqual({ file: 'conditions', line: 4, message: 'Bail inconnu dans baux.csv (BAIL-X)' })
  })
})

describe('parseArgs', () => {
  const id = '00000000-0000-4000-8000-00000000aaaa'
  it('import et annulation', () => {
    expect(parseArgs(['--structure', id, '--dossier', 'x', '--dry-run'])).toMatchObject({ structure: id, folder: 'x', dryRun: true, yes: false })
    expect(parseArgs(['--annuler', id, '--motif', 'erreur', '--oui'])).toMatchObject({ cancel: id, reason: 'erreur', yes: true })
  })
  it('refuse les usages invalides', () => {
    expect(() => parseArgs([])).toThrow(UsageError)
    expect(() => parseArgs(['--structure', 'pas-un-id', '--dossier', 'x'])).toThrow(/identifiant/)
    expect(() => parseArgs(['--annuler', id])).toThrow(/motif/)
    expect(() => parseArgs(['--bizarre'])).toThrow(/inconnue/)
  })
})

describe('formatReport', () => {
  const report: Report = {
    status: 'dry_run',
    errors: [{ file: 'paiements', line: 4, message: 'Bail introuvable (X)' }],
    counts: { payments: 3, leases: 1, expenses: 0 },
    totals: [{ lease: 'BAIL-A', year: 2022, called_cents: 78000, collected_cents: 78000, refunds_net_cents: 0, expenses_cents: 120000, remaining_due_cents: 0 }],
    unpaid: [{ lease: 'BAIL-A', period: '2026-01', due_on: '2026-01-05', balance_cents: 70000 }],
    imposed_differences: [],
  }
  it('imprime décomptes, totaux, impayés et erreurs localisées, sans donnée personnelle', () => {
    const text = formatReport(report)
    expect(text).toContain('ESSAI (dry-run)')
    expect(text).toContain('paiements.csv ligne 4 : Bail introuvable (X)')
    expect(text).toContain('3 paiements')
    expect(text).not.toContain('0 dépenses')
    expect(text).toContain('BAIL-A 2022 : 780,00 € · 780,00 € · 1 200,00 €')
    expect(text).toContain('BAIL-A 2026-01 (échue le 2026-01-05) : reste 700,00 €')
  })
})
