import { redirect } from 'next/navigation'
import { sectionHref } from '@/domains/identity/navigation'

export default async function EntityIndexPage({ params }: PageProps<'/espace/[entityId]'>) {
  const { entityId } = await params
  redirect(sectionHref(entityId, 'tableau-de-bord'))
}
