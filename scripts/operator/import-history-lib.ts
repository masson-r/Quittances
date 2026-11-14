// Reprise d'historique : lecture des fichiers CSV de l'opérateur et construction du lot envoyé à la base.
// Aucune donnée n'est imprimée au-delà de décomptes, de montants agrégés et de références de bail.
export class UsageError extends Error {}

export interface LineError {
  file: string
  line: number
  message: string
}

/** Fichiers attendus (nom sans extension) ; les trois derniers et les échéances sont facultatifs. */
export const REQUIRED_FILES = ['biens', 'locataires', 'baux', 'conditions', 'colocataires'] as const
export const OPTIONAL_FILES = ['echeances', 'paiements', 'depenses', 'apurements'] as const
export const ALL_FILES = [...REQUIRED_FILES, ...OPTIONAL_FILES]

export const USAGE = `Usage :
  pnpm operator:import-history --structure <id> --dossier <chemin> [--dry-run] [--oui]
  pnpm operator:import-history --annuler <id du lot> --motif "<motif>" [--oui]

  --structure  identifiant de la structure
  --dossier    dossier des fichiers CSV (biens, locataires, baux, conditions, colocataires,
               et facultatifs : echeances, paiements, depenses, apurements)
  --dry-run    valide tout et imprime le rapport sans rien écrire
  --annuler    annule en bloc un lot déjà importé (avec --motif)
  --oui        confirme l'exécution sur une base distante (staging ou production)`

export interface Args {
  structure?: string
  folder?: string
  dryRun: boolean
  cancel?: string
  reason?: string
  yes: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--oui') args.yes = true
    else if (a === '--structure') args.structure = argv[++i]
    else if (a === '--dossier') args.folder = argv[++i]
    else if (a === '--annuler') args.cancel = argv[++i]
    else if (a === '--motif') args.reason = argv[++i]
    else throw new UsageError(`Option inconnue : ${a}`)
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (args.cancel) {
    if (!uuid.test(args.cancel)) throw new UsageError('--annuler attend l\'identifiant du lot.')
    if (!args.reason?.trim()) throw new UsageError('--motif est obligatoire pour annuler un lot.')
    return args
  }
  if (!args.structure || !uuid.test(args.structure)) throw new UsageError('--structure attend l\'identifiant de la structure.')
  if (!args.folder) throw new UsageError('--dossier est obligatoire.')
  return args
}

// ---------- CSV ----------

export interface CsvRow {
  line: number
  values: Record<string, string>
}

/** Lit un CSV (séparateur « ; » ou « , » détecté sur l'en-tête, champs entre guillemets, BOM ignoré). */
export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) && firstLine.includes(';') ? ';' : ','

  const records: { line: number; cells: string[] }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  const endRecord = () => {
    cells.push(cell)
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells })
    cells = []
    cell = ''
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else {
        if (ch === '\n') line++
        cell += ch
      }
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++
      endRecord()
      line++
      recordLine = line
    } else cell += ch
  }
  if (cell !== '' || cells.length > 0) endRecord()

  if (records.length === 0) return { header: [], rows: [] }
  const header = records[0].cells.map((h) => h.trim().toLowerCase())
  const rows = records.slice(1).map((r) => ({ line: r.line, values: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').trim()])) }))
  return { header, rows }
}

// ---------- Valeurs ----------

export function parseDate(value: string): string | null {
  const v = value.trim()
  let iso: string | null = null
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v
  else if (fr) iso = `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

/** « 850 », « 850,50 », « 1 250,00 » ou « 850.5 » → centimes ; null si ce n'est pas un montant à deux décimales au plus. */
export function parseAmount(value: string): number | null {
  const text = value.replace(/[\s  €]/g, '')
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(text)
  if (!m) return null
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) && cents <= 99_999_999 ? (m[1] ? -cents : cents) : null
}

const MODES: Record<string, string> = {
  virement: 'transfer',
  cheque: 'cheque',
  chèque: 'cheque',
  especes: 'cash',
  espèces: 'cash',
  autre: 'other',
}

export function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (v === '') return false
  if (['oui', '1', 'vrai', 'true', 'o', 'x'].includes(v)) return true
  if (['non', '0', 'faux', 'false', 'n'].includes(v)) return false
  return null
}

// ---------- Construction du lot ----------

export interface BuiltBatch {
  payload: Record<string, Record<string, unknown>[]>
  errors: LineError[]
}

type Row = CsvRow

export function buildPayload(files: Partial<Record<string, string>>): BuiltBatch {
  const errors: LineError[] = []
  const payload: Record<string, Record<string, unknown>[]> = { properties: [], tenants: [], leases: [], charges: [], payments: [], expenses: [], settlements: [] }
  const fail = (file: string, line: number, message: string) => errors.push({ file, line, message })

  const read = (name: string, columns: string[], required: boolean): Row[] => {
    const text = files[name]
    if (text === undefined) {
      if (required) fail(name, 0, `Fichier ${name}.csv manquant`)
      return []
    }
    const { header, rows } = parseCsv(text)
    const missing = columns.filter((c) => !header.includes(c))
    if (missing.length > 0) {
      fail(name, 1, `Colonne(s) manquante(s) : ${missing.join(', ')}`)
      return []
    }
    return rows
  }

  /** Valide une ligne : exécute `fn` et note toute erreur de format avec le numéro de ligne. */
  const each = (name: string, rows: Row[], fn: (r: Row) => Record<string, unknown> | null, into: Record<string, unknown>[]) => {
    const seen = new Set<string>()
    for (const r of rows) {
      const ref = r.values['ref']
      if (ref !== undefined) {
        if (!ref) {
          fail(name, r.line, 'La référence est obligatoire')
          continue
        }
        if (seen.has(ref)) {
          fail(name, r.line, `Référence en double dans le fichier (${ref})`)
          continue
        }
        seen.add(ref)
      }
      try {
        const built = fn(r)
        if (built) into.push({ line: r.line, ...built })
      } catch (e) {
        fail(name, r.line, e instanceof Error ? e.message : String(e))
      }
    }
  }

  const need = (value: string, label: string): string => {
    if (!value) throw new Error(`${label} est obligatoire`)
    return value
  }
  const date = (value: string, label: string): string => {
    const d = parseDate(value)
    if (!d) throw new Error(`${label} : date invalide (« ${value} »), attendu AAAA-MM-JJ ou JJ/MM/AAAA`)
    return d
  }
  const optDate = (value: string, label: string): string | null => (value ? date(value, label) : null)
  const amount = (value: string, label: string, opts: { min?: number } = {}): number => {
    const a = parseAmount(value)
    if (a === null) throw new Error(`${label} : montant invalide (« ${value} »)`)
    if (opts.min !== undefined && a < opts.min) throw new Error(`${label} : montant trop petit`)
    return a
  }

  each('biens', read('biens', ['ref', 'libelle'], true), (r) => ({
    ref: r.values.ref,
    label: need(r.values.libelle, 'Le libellé'),
    address_line1: r.values.adresse,
    postal_code: r.values.code_postal,
    city: r.values.ville,
  }), payload.properties)

  each('locataires', read('locataires', ['ref', 'nom'], true), (r) => ({
    ref: r.values.ref,
    last_name: need(r.values.nom, 'Le nom'),
    first_name: r.values.prenom ?? '',
    email: r.values.email ?? '',
    phone: r.values.telephone ?? '',
  }), payload.tenants)

  const terms = read('conditions', ['bail', 'a_partir_du', 'loyer', 'charges'], true)
  const cotenants = read('colocataires', ['bail', 'locataire'], true)
  const termsByLease = new Map<string, Record<string, unknown>[]>()
  for (const r of terms) {
    try {
      const lease = need(r.values.bail, 'Le bail')
      const list = termsByLease.get(lease) ?? []
      list.push({ effective_from: date(r.values.a_partir_du, 'a_partir_du'), rent_cents: amount(r.values.loyer, 'loyer', { min: 0 }), charges_cents: amount(r.values.charges || '0', 'charges', { min: 0 }) })
      termsByLease.set(lease, list)
    } catch (e) {
      fail('conditions', r.line, (e as Error).message)
    }
  }
  const tenantsByLease = new Map<string, Record<string, unknown>[]>()
  for (const r of cotenants) {
    try {
      const lease = need(r.values.bail, 'Le bail')
      const list = tenantsByLease.get(lease) ?? []
      list.push({ tenant_ref: need(r.values.locataire, 'Le locataire'), start_date: optDate(r.values.du ?? '', 'du'), end_date: optDate(r.values.au ?? '', 'au') })
      tenantsByLease.set(lease, list)
    } catch (e) {
      fail('colocataires', r.line, (e as Error).message)
    }
  }

  const leaseRows = read('baux', ['ref', 'bien', 'debut', 'jour_echeance'], true)
  each('baux', leaseRows, (r) => {
    const ref = r.values.ref
    const dueDay = Number(r.values.jour_echeance)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('jour_echeance : entier de 1 à 31 attendu')
    return {
      ref,
      property_ref: need(r.values.bien, 'Le bien'),
      start_date: date(r.values.debut, 'debut'),
      end_date: optDate(r.values.fin ?? '', 'fin'),
      due_day: dueDay,
      deposit_cents: r.values.depot ? amount(r.values.depot, 'depot', { min: 0 }) : null,
      terms: (termsByLease.get(ref) ?? []).sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from))),
      tenants: tenantsByLease.get(ref) ?? [],
    }
  }, payload.leases)
  const leaseRefs = new Set(leaseRows.map((r) => r.values.ref))
  for (const [file, map, rows] of [['conditions', termsByLease, terms], ['colocataires', tenantsByLease, cotenants]] as const) {
    for (const r of rows) {
      if (r.values.bail && !leaseRefs.has(r.values.bail)) fail(file, r.line, `Bail inconnu dans baux.csv (${r.values.bail})`)
    }
    void map
  }

  each('echeances', read('echeances', ['bail', 'periode', 'loyer', 'charges'], false), (r) => {
    const period = /^(\d{4})-(\d{2})$/.exec(r.values.periode)
    if (!period || Number(period[2]) < 1 || Number(period[2]) > 12) throw new Error('periode : AAAA-MM attendu')
    return {
      ref: r.values.ref || null,
      lease_ref: need(r.values.bail, 'Le bail'),
      period_start: `${r.values.periode}-01`,
      rent_cents: amount(r.values.loyer, 'loyer', { min: 0 }),
      charges_cents: amount(r.values.charges || '0', 'charges', { min: 0 }),
      due_on: optDate(r.values.date_echeance ?? '', 'date_echeance'),
    }
  }, payload.charges)

  each('paiements', read('paiements', ['ref', 'bail', 'date', 'montant', 'mode'], false), (r) => {
    const mode = MODES[r.values.mode.toLowerCase()]
    if (!mode) throw new Error(`mode inconnu (« ${r.values.mode} ») : virement, cheque, especes ou autre`)
    const period = r.values.periode ?? ''
    if (period && !/^\d{4}-\d{2}$/.test(period)) throw new Error('periode : AAAA-MM attendu')
    return {
      ref: r.values.ref,
      lease_ref: need(r.values.bail, 'Le bail'),
      amount_cents: amount(r.values.montant, 'montant', { min: 1 }),
      received_on: date(r.values.date, 'date'),
      mode,
      reference: r.values.reference ?? '',
      period_start: period ? `${period}-01` : null,
    }
  }, payload.payments)

  each('depenses', read('depenses', ['ref', 'bien', 'date', 'categorie', 'description', 'montant'], false), (r) => {
    const recoverable = parseBool(r.values.recuperable ?? '')
    if (recoverable === null) throw new Error('recuperable : oui ou non attendu')
    return {
      ref: r.values.ref,
      property_ref: need(r.values.bien, 'Le bien'),
      category: need(r.values.categorie, 'La catégorie'),
      expense_date: date(r.values.date, 'date'),
      description: need(r.values.description, 'La description'),
      amount_cents: amount(r.values.montant, 'montant', { min: 1 }),
      recoverable,
    }
  }, payload.expenses)

  each('apurements', read('apurements', ['ref', 'bail', 'date', 'montant', 'mode', 'motif'], false), (r) => {
    const mode = MODES[r.values.mode.toLowerCase()]
    if (!mode) throw new Error(`mode inconnu (« ${r.values.mode} »)`)
    const isFinal = parseBool(r.values.final ?? '')
    if (isFinal === null) throw new Error('final : oui ou non attendu')
    return {
      ref: r.values.ref,
      lease_ref: need(r.values.bail, 'Le bail'),
      settled_on: date(r.values.date, 'date'),
      amount_cents: amount(r.values.montant, 'montant'),
      mode,
      reason: need(r.values.motif, 'Le motif'),
      is_final: isFinal,
      period_start: optDate(r.values.debut_periode ?? '', 'debut_periode'),
      period_end: optDate(r.values.fin_periode ?? '', 'fin_periode'),
    }
  }, payload.settlements)

  return { payload, errors }
}

// ---------- Rapport ----------

export interface Report {
  status: string
  batch_id?: string | null
  errors: LineError[]
  counts: Record<string, number>
  totals: { lease: string; year: number; called_cents: number; collected_cents: number; refunds_net_cents: number; expenses_cents: number; remaining_due_cents: number }[]
  unpaid: { lease: string; period: string; due_on: string; balance_cents: number }[]
  imposed_differences: { lease: string; period: string; imposed_cents: number; computed_cents: number }[]
}

export const euros = (cents: number): string => {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${String(abs % 100).padStart(2, '0')} €`
}

const LABELS: Record<string, string> = {
  properties: 'biens créés', properties_reused: 'biens réutilisés', tenants: 'dossiers créés', tenants_reused: 'dossiers réutilisés',
  leases: 'baux créés', leases_reused: 'baux réutilisés', charges_calculated: 'échéances calculées', charges_imposed: 'échéances imposées',
  payments: 'paiements', allocations: 'affectations', expenses: 'dépenses', settlements: 'apurements',
}

export const STATUS_TEXT: Record<string, string> = {
  imported: 'IMPORT TERMINÉ : le lot est enregistré.',
  dry_run: 'ESSAI (dry-run) : rien n\'a été écrit.',
  rejected: 'LOT REJETÉ : rien n\'a été écrit.',
  already_imported: 'Ces fichiers ont déjà été importés : aucun effet.',
}

/** Rapport lisible : décomptes, totaux par bail et par année, échéances impayées, écarts d'échéances imposées, erreurs. */
export function formatReport(report: Report): string {
  const out: string[] = [STATUS_TEXT[report.status] ?? report.status]
  if (report.batch_id) out.push(`Lot : ${report.batch_id}`)
  if (report.errors.length > 0) {
    out.push('', `Erreurs (${report.errors.length}) :`)
    for (const e of report.errors) out.push(`  ${e.file}.csv ligne ${e.line} : ${e.message}`)
  }
  const counts = Object.entries(report.counts ?? {}).filter(([, n]) => n > 0)
  if (counts.length > 0) {
    out.push('', 'Lignes :')
    for (const [k, n] of counts) out.push(`  ${n} ${LABELS[k] ?? k}`)
  }
  if (report.totals?.length > 0) {
    out.push('', 'Totaux par bail et par année (appelé · encaissé · dépenses du bien · remboursements nets · restant dû) :')
    for (const t of report.totals) {
      out.push(`  ${t.lease} ${t.year} : ${euros(t.called_cents)} · ${euros(t.collected_cents)} · ${euros(t.expenses_cents)} · ${euros(t.refunds_net_cents)} · ${euros(t.remaining_due_cents)}`)
    }
  }
  if (report.unpaid?.length > 0) {
    out.push('', `Échéances restées impayées (${report.unpaid.length}) :`)
    for (const u of report.unpaid) out.push(`  ${u.lease} ${u.period} (échue le ${u.due_on}) : reste ${euros(u.balance_cents)}`)
  }
  if (report.imposed_differences?.length > 0) {
    out.push('', 'Écarts entre échéances imposées et calcul :')
    for (const d of report.imposed_differences) out.push(`  ${d.lease} ${d.period} : imposé ${euros(d.imposed_cents)}, calculé ${euros(d.computed_cents)}`)
  }
  return out.join('\n')
}
