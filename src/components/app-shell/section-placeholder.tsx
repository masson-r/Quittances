import { NAV_ITEMS } from '@/domains/identity/navigation'
import { requireSection } from '@/domains/identity/entity-access'

/** Section pas encore construite : titre, structure, et mention claire. Remplacée au fil des tickets. */
export async function SectionPlaceholder({ params, slug }: { params: Promise<{ entityId: string }>; slug: string }) {
  const { entityId } = await params
  const { entityName } = await requireSection(entityId, slug)
  const label = NAV_ITEMS.find((i) => i.slug === slug)?.label ?? ''
  return (
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold">{label}</h1>
      <p className="text-muted-foreground">{entityName}</p>
      <p className="mt-4 rounded-lg border border-dashed p-6 text-sm">Cette section sera disponible prochainement.</p>
    </div>
  )
}
