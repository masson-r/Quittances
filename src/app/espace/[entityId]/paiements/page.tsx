import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SectionPlaceholder } from '@/components/app-shell/section-placeholder'

export const metadata: Metadata = { title: 'Paiements — Loyo-reg' }

export default function Page({ params }: PageProps<'/espace/[entityId]/paiements'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <SectionPlaceholder params={params} slug="paiements" />
    </Suspense>
  )
}
