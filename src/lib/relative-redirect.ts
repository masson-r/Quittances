import { NextResponse } from 'next/server'

/**
 * Redirection par chemin relatif : le navigateur reste sur l'hôte où il se trouve, donc ses cookies de session
 * (propres à cet hôte) restent valables, quelle que soit la façon dont le serveur voit sa propre adresse.
 */
export function relativeRedirect(path: string, status: 303 | 307 = 303) {
  return new NextResponse(null, { status, headers: { Location: path } })
}
