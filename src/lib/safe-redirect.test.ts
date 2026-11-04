import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-redirect'

describe('safeNextPath', () => {
  it('garde un chemin interne', () => {
    expect(safeNextPath('/espace/biens?page=2')).toBe('/espace/biens?page=2')
  })

  it.each([
    ['https://pirate.example', 'URL absolue'],
    ['//pirate.example', 'URL sans protocole'],
    ['/\\pirate.example', 'barre oblique inverse'],
    ['\\\\pirate.example', 'deux barres inverses'],
    ['javascript:alert(1)', 'schéma javascript'],
    ['espace', 'chemin relatif'],
    ['/espace\r\nSet-Cookie: x=1', 'retour à la ligne'],
    ['', 'vide'],
  ])('refuse %s (%s)', (value) => {
    expect(safeNextPath(value)).toBe('/espace')
  })

  it('revient au repli pour null et undefined', () => {
    expect(safeNextPath(null)).toBe('/espace')
    expect(safeNextPath(undefined, '/connexion')).toBe('/connexion')
  })
})
