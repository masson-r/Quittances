export const MAX_SIGNATURE_BYTES = 500 * 1024
export const MAX_SIGNATURE_WIDTH = 1200
export const MAX_SIGNATURE_HEIGHT = 600

export type SignatureType = 'image/png' | 'image/jpeg'

export interface SignatureImage {
  contentType: SignatureType
  width: number
  height: number
  /** Image sans métadonnées (EXIF, XMP, commentaires, textes…), pixels inchangés. */
  bytes: Uint8Array
}

export class SignatureImageError extends Error {}

const fail = (message: string): never => {
  throw new SignatureImageError(message)
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** Blocs conservés : ceux qui servent à l'affichage ; tout le reste (eXIf, tEXt, iTXt, tIME, iCCP…) est retiré. */
const PNG_KEPT = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB'])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

function cleanPng(input: Uint8Array): SignatureImage {
  const kept: Uint8Array[] = [input.subarray(0, 8)]
  let width = 0
  let height = 0
  let pos = 8
  let sawEnd = false
  let sawData = false
  let first = true
  while (pos + 12 <= input.length && !sawEnd) {
    const length = u32(input, pos)
    const type = ascii(input, pos + 4, 4)
    const end = pos + 12 + length
    if (end > input.length) fail('Le fichier PNG est tronqué ou corrompu.')
    if (first && type !== 'IHDR') fail('Le fichier PNG est corrompu.')
    first = false
    if (crc32(input.subarray(pos + 4, pos + 8 + length)) !== u32(input, end - 4)) fail('Le fichier PNG est corrompu.')
    if (type === 'IHDR') {
      if (length !== 13) fail('Le fichier PNG est corrompu.')
      width = u32(input, pos + 8)
      height = u32(input, pos + 12)
    }
    if (type === 'IDAT') sawData = true
    if (type === 'IEND') sawEnd = true
    if (PNG_KEPT.has(type)) kept.push(input.subarray(pos, end))
    pos = end
  }
  if (!sawEnd || !sawData) fail('Le fichier PNG est tronqué ou corrompu.')
  return { contentType: 'image/png', width, height, bytes: concat(kept) }
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function cleanJpeg(input: Uint8Array): SignatureImage {
  const kept: Uint8Array[] = [input.subarray(0, 2)]
  let width = 0
  let height = 0
  let pos = 2
  while (pos < input.length) {
    if (input[pos] !== 0xff) fail('Le fichier JPEG est corrompu.')
    let marker = input[pos + 1]
    while (marker === 0xff) marker = input[++pos + 1]
    if (marker === 0xd9) fail('Le fichier JPEG ne contient aucune image.')
    const length = u16(input, pos + 2)
    const end = pos + 2 + length
    if (length < 2 || end > input.length) fail('Le fichier JPEG est tronqué ou corrompu.')
    if (SOF.has(marker)) {
      if (length < 8) fail('Le fichier JPEG est corrompu.')
      height = u16(input, pos + 5)
      width = u16(input, pos + 7)
    }
    if (marker === 0xda) {
      // Début des données d'image : tout le reste est conservé tel quel.
      if (width === 0 || height === 0) fail('Le fichier JPEG est corrompu.')
      kept.push(input.subarray(pos))
      return { contentType: 'image/jpeg', width, height, bytes: concat(kept) }
    }
    // Conservés : JFIF (APP0), Adobe (APP14), tables et cadre de l'image. Retirés : EXIF/XMP (APP1…), commentaires.
    const metadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe
    if (!metadata) kept.push(input.subarray(pos, end))
    pos = end
  }
  return fail('Le fichier JPEG est tronqué ou corrompu.')
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * Valide une image de signature (PNG ou JPEG, 500 Ko et 1 200 × 600 pixels au maximum) et en retire les métadonnées.
 * Le type est reconnu à l'en-tête du fichier, jamais d'après son nom ou le type déclaré.
 */
export function prepareSignatureImage(input: Uint8Array): SignatureImage {
  if (input.length === 0) fail('Choisissez une image.')
  if (input.length > MAX_SIGNATURE_BYTES) fail('L\'image dépasse 500 Ko.')

  let image: SignatureImage
  if (PNG_MAGIC.every((b, i) => input[i] === b)) image = cleanPng(input)
  else if (input[0] === 0xff && input[1] === 0xd8) image = cleanJpeg(input)
  else return fail('Le fichier doit être une image PNG ou JPEG.')

  if (image.width < 1 || image.height < 1) fail('L\'image est vide.')
  if (image.width > MAX_SIGNATURE_WIDTH || image.height > MAX_SIGNATURE_HEIGHT) {
    fail(`L'image dépasse 1 200 × 600 pixels (${image.width} × ${image.height}).`)
  }
  return image
}
