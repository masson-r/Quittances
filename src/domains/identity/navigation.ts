export interface NavItem {
  slug: string
  label: string
  /** Permission de lecture qui rend la section visible. */
  permission: string
}

/** Sections de l'espace d'une structure, dans l'ordre du menu. */
export const NAV_ITEMS: NavItem[] = [
  { slug: 'tableau-de-bord', label: 'Tableau de bord', permission: 'structure:read' },
  { slug: 'biens', label: 'Biens', permission: 'property:read' },
  { slug: 'locataires', label: 'Locataires', permission: 'tenant:read' },
  { slug: 'baux', label: 'Baux', permission: 'lease:read' },
  { slug: 'paiements', label: 'Échéances et paiements', permission: 'payment:read' },
  { slug: 'impayes', label: 'Impayés', permission: 'rent_charge:read' },
  { slug: 'quittances', label: 'Quittances', permission: 'receipt:read' },
  { slug: 'depenses', label: 'Dépenses', permission: 'expense:read' },
  { slug: 'membres', label: 'Membres', permission: 'member:read' },
]

export const visibleNav = (permissions: readonly string[]): NavItem[] => NAV_ITEMS.filter((item) => permissions.includes(item.permission))

export const sectionHref = (entityId: string, slug: string): string => `/espace/${entityId}/${slug}`

/** Section affichée d'après l'adresse (`/espace/<structure>/<section>/…`), tableau de bord par défaut. */
export function sectionFromPath(pathname: string): string {
  const slug = pathname.split('/')[3]
  return NAV_ITEMS.some((item) => item.slug === slug) ? slug : 'tableau-de-bord'
}
