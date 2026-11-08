import { describe, expect, it } from 'vitest'
import { crc32, prepareSignatureImage, SignatureImageError } from './image'

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number) => [(n >>> 8) & 255, n & 255]

function pngChunk(type: string, data: number[]): number[] {
  const body = [...Buffer.from(type, 'ascii'), ...data]
  return [...be32(data.length), ...body, ...be32(crc32(Uint8Array.from(body)))]
}

function png(width: number, height: number, extra: number[][] = []): Uint8Array {
  const ihdr = pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0])
  const idat = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])
  const iend = pngChunk('IEND', [])
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...extra.flat(), ...idat, ...iend])
}

const app = (marker: number, payload: string) => [0xff, marker, ...be16(payload.length + 2), ...Buffer.from(payload, 'ascii')]

function jpeg(width: number, height: number, extra: number[][] = []): Uint8Array {
  const sof = [0xff, 0xc0, ...be16(11), 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]
  const sos = [0xff, 0xda, ...be16(8), 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9]
  return Uint8Array.from([0xff, 0xd8, ...app(0xe0, 'JFIF\0'), ...extra.flat(), ...sof, ...sos])
}

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

describe('prepareSignatureImage — PNG', () => {
  it('lit les dimensions et conserve les blocs d\'affichage', () => {
    const image = prepareSignatureImage(png(600, 300))
    expect(image).toMatchObject({ contentType: 'image/png', width: 600, height: 300 })
  })

  it('retire les métadonnées (eXIf, tEXt, tIME) sans toucher aux pixels', () => {
    const original = png(600, 300, [pngChunk('eXIf', [1, 2, 3, 4]), pngChunk('tEXt', [...Buffer.from('Author\0Marie')]), pngChunk('tIME', [7, 234, 1, 1, 0, 0, 0])])
    const image = prepareSignatureImage(original)
    expect(text(image.bytes)).not.toMatch(/eXIf|tEXt|tIME|Marie/)
    expect(text(image.bytes)).toContain('IDAT')
    expect(image.bytes).toEqual(png(600, 300))
    expect(image.bytes.length).toBeLessThan(original.length)
  })

  it.each([
    ['1 200 × 600', 1200, 600, true],
    ['1 201 × 600', 1201, 600, false],
    ['1 200 × 601', 1200, 601, false],
    ['0 × 10', 0, 10, false],
  ])('dimensions %s', (_label, w, h, ok) => {
    if (ok) expect(prepareSignatureImage(png(w, h))).toMatchObject({ width: w, height: h })
    else expect(() => prepareSignatureImage(png(w, h))).toThrow(SignatureImageError)
  })

  it('refuse un fichier corrompu ou tronqué', () => {
    const good = png(10, 10)
    const flipped = Uint8Array.from(good)
    flipped[20] ^= 0xff
    expect(() => prepareSignatureImage(flipped)).toThrow(/corrompu/)
    expect(() => prepareSignatureImage(good.subarray(0, good.length - 14))).toThrow(SignatureImageError)
  })
})

describe('prepareSignatureImage — JPEG', () => {
  it('lit les dimensions', () => {
    expect(prepareSignatureImage(jpeg(800, 400))).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 400 })
  })

  it('retire EXIF, XMP et commentaires, conserve JFIF et les données d\'image', () => {
    const original = jpeg(800, 400, [app(0xe1, 'Exif\0\0GPS-secret'), app(0xe1, 'http://ns.adobe.com/xap/1.0/\0xmp'), app(0xfe, 'commentaire privé')])
    const image = prepareSignatureImage(original)
    expect(text(image.bytes)).not.toMatch(/Exif|GPS-secret|xap|commentaire/)
    expect(text(image.bytes)).toContain('JFIF')
    expect(image.bytes).toEqual(jpeg(800, 400))
  })

  it('refuse les dimensions excessives et un fichier tronqué', () => {
    expect(() => prepareSignatureImage(jpeg(1300, 400))).toThrow(/1 200 × 600/)
    expect(() => prepareSignatureImage(jpeg(100, 100).subarray(0, 30))).toThrow(SignatureImageError)
  })
})

describe('prepareSignatureImage — contrôles généraux', () => {
  it('reconnaît le type à l\'en-tête, pas au contenu déclaré', () => {
    expect(() => prepareSignatureImage(Uint8Array.from(Buffer.from('GIF89a......')))).toThrow(/PNG ou JPEG/)
    expect(() => prepareSignatureImage(Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toThrow(/PNG ou JPEG/)
  })

  it('refuse un fichier vide ou de plus de 500 Ko', () => {
    expect(() => prepareSignatureImage(new Uint8Array())).toThrow(/Choisissez/)
    const big = png(100, 100, [pngChunk('tEXt', new Array(510 * 1024).fill(65))])
    expect(() => prepareSignatureImage(big)).toThrow(/500 Ko/)
  })

  it('accepte exactement 500 Ko', () => {
    const base = png(100, 100)
    const pad = 500 * 1024 - base.length - 12
    const exact = png(100, 100, [pngChunk('tEXt', new Array(pad).fill(65))])
    expect(exact.length).toBe(500 * 1024)
    expect(prepareSignatureImage(exact).bytes.length).toBe(base.length)
  })
})
