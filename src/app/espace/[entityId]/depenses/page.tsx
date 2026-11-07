import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SectionPlaceholder } from '@/components/app-shell/section-placeholder'

export const metadata: Metadata = { title: 'Dépenses — Loyo-reg' }

export default function Page({ params }: PageProps<'/espace/[entityId]/depenses'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <SectionPlaceholder params={params} slug="depenses" />
    </Suspense>
  )
}
