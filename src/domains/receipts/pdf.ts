import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { centsInWords } from './words'
import type { ReceiptSnapshot } from './snapshot'

export interface SignatureBytes {
  contentType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 46
const NBSP = ' '

const BLUE = rgb(0.169, 0.424, 0.69)
const ORANGE = rgb(0.753, 0.337, 0.129)
const GREEN = rgb(0.184, 0.522, 0.349)
const INK = rgb(0.07, 0.09, 0.15)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE = rgb(0.82, 0.84, 0.86)
const TRACK = rgb(0.9, 0.91, 0.92)

const MODES: Record<string, string> = { transfer: 'Virement', cheque: 'Chèque', cash: 'Espèces', other: 'Autre moyen' }

/** 85000 → « 850,00 € » avec espaces insécables ordinaires (les polices de base du PDF n'ont pas l'espace fine). */
export function pdfEuros(cents: number): string {
  const euros = Math.floor(cents / 100)
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${grouped},${String(cents % 100).padStart(2, '0')}${NBSP}€`
}

/** AAAA-MM-JJ → JJ/MM/AAAA. */
export const pdfDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthTitle = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`.replace(/^./, (c) => c.toUpperCase())

const LATIN_FALLBACK: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', ı: 'i', ĳ: 'ij', ŀ: 'l' }

/** Remplace les caractères que la police standard ne sait pas écrire (alphabets non latins…) au lieu d'échouer. */
function makeSafe(font: PDFFont) {
  const supported = new Set(font.getCharacterSet())
  return (text: string): string =>
    Array.from(text.normalize('NFC'))
      .map((ch) => {
        if (supported.has(ch.codePointAt(0)!)) return ch
        const base = (LATIN_FALLBACK[ch] ?? ch.normalize('NFD')).replace(/[̀-ͯ]/g, '')
        return base !== ch && Array.from(base).every((b) => supported.has(b.codePointAt(0)!)) ? base : '?'
      })
      .join('')
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

const lessorLines = (s: ReceiptSnapshot): string[] =>
  [s.lessor.name, s.lessor.address_line, [s.lessor.postal_code, s.lessor.city].filter(Boolean).join(' '), s.lessor.siret ? `SIRET ${s.lessor.siret}` : null].filter(
    (x): x is string => Boolean(x),
  )

const propertyLines = (s: ReceiptSnapshot): string[] =>
  [s.property.label, s.property.address_line1, s.property.address_line2, [s.property.postal_code, s.property.city].filter(Boolean).join(' ')].filter(
    (x): x is string => Boolean(x),
  )

/** Phrase de déclaration : montant en chiffres et en lettres, période, nature du document. */
export function declaration(s: ReceiptSnapshot): string {
  const tenants = s.tenants.length > 0 ? s.tenants.join(' et ') : 'le locataire'
  const period = `du ${pdfDate(s.period.start)} au ${pdfDate(s.period.end)}`
  const lessor = `Je soussigné(e), ${s.lessor.name}, bailleur,`
  if (s.kind === 'quittance') {
    return (
      `${lessor} déclare avoir reçu de ${tenants} la somme de ${centsInWords(s.amount_cents)} (${pdfEuros(s.amount_cents)}) au titre du loyer et des charges ` +
      `de la période ${period}, et lui en donne quittance, sous réserve de tous mes droits. ` +
      'Cette quittance annule tous les reçus établis précédemment en cas de paiement partiel du même terme.'
    )
  }
  return (
    `${lessor} déclare avoir reçu de ${tenants} la somme de ${centsInWords(s.amount_cents)} (${pdfEuros(s.amount_cents)}) à valoir sur le loyer et les charges ` +
    `de la période ${period} (échéance de ${pdfEuros(s.total_cents)}). Il s'agit d'un paiement partiel : ce document est un reçu, il ne vaut pas quittance. ` +
    `Reste dû à la date d'émission : ${pdfEuros(s.remaining_cents)}.`
  )
}

const LEGAL =
  "Document émis par l'application de gestion locative ; il reproduit les informations figées au jour de son émission. " +
  'À conserver : les actions dérivant du bail se prescrivent par trois ans (art. 7-1, loi n° 89-462 du 6 juillet 1989). ' +
  "Aucun frais n'est facturé pour la délivrance de ce document (art. 21)."

/**
 * Construit le PDF d'une quittance ou d'un reçu partiel (mise en page « relevé compact », variante C), uniquement à
 * partir de l'instantané enregistré à l'émission. Appelée une seule fois par document : le fichier produit est stocké.
 */
export async function buildReceiptPdf(snapshot: ReceiptSnapshot, signature: SignatureBytes | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const safe = makeSafe(regular)
  const page = doc.addPage([A4.width, A4.height])
  const s = snapshot
  const isReceipt = s.kind === 'partial_receipt'
  const accent = isReceipt ? ORANGE : BLUE
  const { width: W, height: H } = A4

  const text = (value: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' | 'center' } = {}) => {
    const font = o.font ?? regular
    const size = o.size ?? 10
    const t = safe(value)
    const w = font.widthOfTextAtSize(t, size)
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
    page.drawText(t, { x: left, y, size, font, color: o.color ?? INK })
  }
  const paragraph = (value: string, x: number, yTop: number, width: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = o.size ?? 9.5
    const lines = wrap(safe(value), o.font ?? regular, size, width)
    lines.forEach((line, i) => text(line, x, yTop - size * 1.38 * (i + 1) + size * 0.3, { ...o, size }))
    return lines.length * size * 1.38
  }
  const rule = (x1: number, y: number, x2: number, color = RULE, thickness = 0.8) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness })

  // Bande verticale distinctive (bleue : quittance, orange : reçu).
  page.drawRectangle({ x: 0, y: 0, width: 14, height: H, color: accent })

  text("GESTION LOCATIVE  /  DOCUMENT FIGÉ À L'ÉMISSION", MARGIN, H - 38, { size: 8, color: MUTED })
  text(`${s.number}  •  émis le ${pdfDate(s.issued_on)}${s.version > 1 ? `  •  version ${s.version}` : ''}`, W - MARGIN, H - 38, { size: 8, color: MUTED, align: 'right' })
  rule(MARGIN, H - 46, W - MARGIN)

  // Puce de genre.
  const chip = isReceipt ? 'REÇU — PAS UNE QUITTANCE' : 'QUITTANCE'
  const chipWidth = bold.widthOfTextAtSize(safe(chip), 10) + 20
  page.drawRectangle({ x: MARGIN, y: H - 86, width: chipWidth, height: 22, color: accent })
  text(chip, MARGIN + 10, H - 79, { size: 10, font: bold, color: rgb(1, 1, 1) })

  text(monthTitle(s.period.start), MARGIN, H - 128, { size: 30, font: bold })
  text(`du ${pdfDate(s.period.start)} au ${pdfDate(s.period.end)}  •  ${pdfEuros(s.total_cents)} d'échéance`, MARGIN, H - 146, { size: 10, color: MUTED })

  // Trois colonnes : bailleur, locataires, logement.
  const colWidth = (W - 2 * MARGIN) / 3
  const columns: [string, string[]][] = [
    ['BAILLEUR', lessorLines(s)],
    ['LOCATAIRES', s.tenants.length > 0 ? [...s.tenants, 'un seul document pour le bail'] : ['—']],
    ['LOGEMENT', propertyLines(s)],
  ]
  const columnsTop = H - 180
  columns.forEach(([title, lines], i) => {
    const x = MARGIN + i * colWidth
    if (i > 0) page.drawLine({ start: { x: x - 8, y: columnsTop }, end: { x: x - 8, y: columnsTop - 74 }, color: RULE, thickness: 0.8 })
    text(title, x, columnsTop - 2, { size: 8, font: bold, color: accent })
    let y = columnsTop - 10
    lines.forEach((line, k) => {
      const small = s.tenants.length > 0 && i === 1 && k === lines.length - 1
      y -= paragraph(line, x, y, colWidth - 20, { size: small ? 8 : 9.5, color: small ? MUTED : INK })
    })
  })

  // Frise des règlements.
  let y = H - 280
  text('Règlements', MARGIN, y, { size: 11, font: bold })
  y -= 24
  const settlements = s.settlements
  if (settlements.length === 0) {
    text('Aucun règlement enregistré.', MARGIN, y, { size: 9, color: MUTED })
    y -= 30
  } else if (settlements.length <= 4) {
    const x0 = MARGIN + 20
    const x1 = W - MARGIN - 20
    rule(x0, y, x1, rgb(0.61, 0.64, 0.69), 2)
    settlements.forEach((p, i) => {
      const n = settlements.length
      const x = n === 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1)
      page.drawCircle({ x, y, size: 6, color: accent })
      const align = n === 1 || i === 0 ? 'left' : i === n - 1 ? 'right' : 'center'
      const anchor = align === 'left' ? x - 12 : align === 'right' ? x + 12 : x
      text(pdfDate(p.received_on), anchor, y - 22, { size: 10, font: bold, align })
      text(`${MODES[p.mode] ?? p.mode} ${pdfEuros(p.amount_cents)}`, anchor, y - 35, { size: 9, color: MUTED, align })
    })
    y -= 66
  } else {
    settlements.forEach((p) => {
      text(`${pdfDate(p.received_on)}  ${MODES[p.mode] ?? p.mode}`, MARGIN, y, { size: 9.5 })
      text(pdfEuros(p.amount_cents), W - MARGIN, y, { size: 9.5, align: 'right' })
      y -= 15
    })
    y -= 12
  }

  // Jauge : reçu sur échéance.
  const gaugeWidth = W - 2 * MARGIN
  const ratio = s.total_cents === 0 ? 0 : Math.min(1, s.received_cents / s.total_cents)
  page.drawRectangle({ x: MARGIN, y: y - 16, width: gaugeWidth, height: 16, color: TRACK })
  if (ratio > 0) page.drawRectangle({ x: MARGIN, y: y - 16, width: gaugeWidth * ratio, height: 16, color: isReceipt ? ORANGE : GREEN })
  text(`Reçu ${pdfEuros(s.received_cents)} sur ${pdfEuros(s.total_cents)}`, MARGIN, y - 34, { size: 10, font: bold })
  text(isReceipt ? `Reste dû ${pdfEuros(s.remaining_cents)}` : `Soldé le ${pdfDate(s.paid_on)}`, W - MARGIN, y - 34, { size: 10, font: bold, align: 'right' })
  y -= 62

  // Décomposition.
  const tableWidth = W - 2 * MARGIN
  const rows: [string, string][] = [
    ['Loyer hors charges', pdfEuros(s.rent_cents)],
    ['Provisions sur charges', pdfEuros(s.charges_cents)],
    ["Total de l'échéance", pdfEuros(s.total_cents)],
  ]
  text('Décomposition', MARGIN, y, { size: 9.5, font: bold })
  text('Montant', W - MARGIN, y, { size: 9.5, font: bold, align: 'right' })
  rule(MARGIN, y - 6, MARGIN + tableWidth, accent, 1)
  y -= 22
  rows.forEach(([label, amount], i) => {
    const last = i === rows.length - 1
    text(label, MARGIN, y, { size: 9.5, font: last ? bold : regular })
    text(amount, W - MARGIN, y, { size: 9.5, font: last ? bold : regular, align: 'right' })
    if (!last) rule(MARGIN, y - 6, MARGIN + tableWidth, RULE, 0.5)
    y -= 19
  })
  y -= 14

  // Déclaration.
  y -= paragraph(declaration(s), MARGIN, y, W - 2 * MARGIN, { size: 9.5, color: rgb(0.12, 0.16, 0.22) })

  // Signature : image du bailleur si elle existe, sinon seulement la mention.
  const signatureTop = 168
  text('Signature du bailleur', MARGIN, signatureTop, { size: 8.5 })
  if (signature) {
    const image = signature.contentType === 'image/png' ? await doc.embedPng(signature.bytes) : await doc.embedJpg(signature.bytes)
    const scale = Math.min(190 / image.width, 56 / image.height, 1)
    page.drawImage(image, { x: MARGIN, y: 100, width: image.width * scale, height: image.height * scale })
  }
  rule(MARGIN, 98, MARGIN + 190, INK, 0.8)
  text(`Signé électroniquement par ${s.issuer || s.lessor.name} — document ${s.number}`, MARGIN, 86, { size: 7.5, color: MUTED })
  paragraph(LEGAL, MARGIN + 230, signatureTop + 4, W - 2 * MARGIN - 230, { size: 7, color: MUTED })

  doc.setTitle(`${isReceipt ? 'Reçu' : 'Quittance'} ${s.number}`)
  doc.setProducer('Loyo-reg')
  doc.setCreator('Loyo-reg')
  // Date de création fixée à celle de l'émission : le fichier ne dépend pas de l'heure de génération.
  const created = new Date(`${s.issued_on}T12:00:00Z`)
  doc.setCreationDate(created)
  doc.setModificationDate(created)
  return doc.save()
}

export type { PDFPage }
