// Contrôle des migrations : opérations destructives sans annotation, et modification de l'historique.
// Usage : node scripts/check-migrations.mjs [--base <ref git>]
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const MIGRATIONS_DIR = 'supabase/migrations'
const RULES = [
  { re: /\bdrop\b/gi, rule: 'DROP' },
  { re: /\brename\b/gi, rule: 'RENAME' },
  { re: /\btruncate\b/gi, rule: 'TRUNCATE' },
]
const ANNOTATION = /allow-destructive:\s*\S/

// Sépare chaque ligne en code (chaînes et commentaires blanchis) et texte de commentaire.
function split(sql) {
  const code = []
  const comments = []
  let inString = false
  let inBlock = false
  for (const line of sql.split(/\r?\n/)) {
    let c = ''
    let k = ''
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const two = line.slice(i, i + 2)
      if (inBlock) {
        if (two === '*/') { inBlock = false; i++ } else k += ch
        c += ' '
      } else if (inString) {
        if (ch === "'") {
          if (line[i + 1] === "'") { i++; c += ' ' } else inString = false
        }
        c += ' '
      } else if (two === '--') {
        k += line.slice(i + 2)
        break
      } else if (two === '/*') {
        inBlock = true; i++; c += ' '
      } else if (ch === "'") {
        inString = true; c += ' '
      } else c += ch
    }
    code.push(c)
    comments.push(k)
  }
  return { code, comments }
}

export function findDestructive(file, sql) {
  const { code, comments } = split(sql)
  const found = []
  code.forEach((text, i) => {
    for (const { re, rule } of RULES) {
      re.lastIndex = 0
      if (!re.test(text)) continue
      const allowed = ANNOTATION.test(comments[i]) || (i > 0 && ANNOTATION.test(comments[i - 1]) && code[i - 1].trim() === '')
      if (!allowed) found.push({ file, line: i + 1, rule: `${rule} sans annotation « -- allow-destructive: <motif> »` })
    }
  })
  return found
}

// `git diff --name-status` : seul l'ajout de fichiers est permis (migrations à sens unique).
export function findHistoryChanges(nameStatus) {
  const found = []
  for (const line of nameStatus.split(/\r?\n/).filter(Boolean)) {
    const [status, file] = line.split('\t')
    if (status !== 'A') found.push({ file, rule: `migration existante modifiée, supprimée ou renommée (${status})` })
  }
  return found
}

function main() {
  const problems = []
  for (const name of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
    const file = `${MIGRATIONS_DIR}/${name}`
    problems.push(...findDestructive(file, readFileSync(file, 'utf8')))
  }
  const base = process.argv[process.argv.indexOf('--base') + 1]
  if (process.argv.includes('--base') && base) {
    const diff = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', MIGRATIONS_DIR], { encoding: 'utf8' })
    problems.push(...findHistoryChanges(diff))
  }
  for (const p of problems) console.error(`${p.file}${p.line ? `:${p.line}` : ''} : ${p.rule}`)
  if (problems.length) process.exit(1)
  console.log('Migrations : aucun problème.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
