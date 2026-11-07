import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SectionPlaceholder } from '@/components/app-shell/section-placeholder'

export const metadata: Metadata = { title: 'Tableau de bord — Loyo-reg' }

export default function Page({ params }: PageProps<'/espace/[entityId]/tableau-de-bord'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <SectionPlaceholder params={params} slug="tableau-de-bord" />
    </Suspense>
  )
}
