/** Chemin de redirection après connexion : interne uniquement, sinon le repli (pas de redirection ouverte). */
export function safeNextPath(next: string | null | undefined, fallback = '/espace'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) {
    return fallback
  }
  return next
}
