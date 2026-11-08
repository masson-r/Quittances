import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSection } from '@/domains/identity/entity-access'
import { getMySignature } from '@/domains/signatures/service'
import { formatDateFr } from '@/lib/dates'
import { RemoveSignatureForm, UploadSignatureForm } from './forms'

export const metadata: Metadata = { title: 'Ma signature — Loyo-reg' }

async function MySignature({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const { entityName, permissions } = await requireSection(entityId, 'quittances')
  if (!permissions.includes('signature:write')) notFound()
  const signature = await getMySignature(entityId)

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Ma signature</h1>
        <p className="text-muted-foreground">{entityName}</p>
        <Link href={`/espace/${entityId}/quittances`} className="text-sm underline">
          Retour aux quittances
        </Link>
      </header>

      <p className="max-w-prose text-sm">
        L&apos;image que vous téléversez figure sur les quittances que <strong>vous</strong> émettez. Elle est facultative : sans image, le document porte
        seulement la mention « signé électroniquement » et son identifiant. Personne d&apos;autre ne voit ni n&apos;utilise votre signature.
      </p>

      {signature ? (
        <section aria-labelledby="actuelle" className="grid gap-3">
          <h2 id="actuelle" className="text-lg font-semibold">
            Signature actuelle
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- image privée en data URL, non optimisable */}
          <img
            src={signature.dataUrl}
            alt="Aperçu de votre signature"
            width={signature.width}
            height={signature.height}
            className="max-h-40 w-auto max-w-full rounded border bg-white p-2"
            data-testid="signature-preview"
          />
          <p className="text-muted-foreground text-sm">
            Enregistrée le {formatDateFr(signature.createdAt.slice(0, 10))} · {signature.width} × {signature.height} px · {Math.ceil(signature.byteSize / 1024)} Ko
          </p>
          <RemoveSignatureForm entityId={entityId} />
        </section>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm" data-testid="no-signature">
          Aucune signature enregistrée.
        </p>
      )}

      <section aria-labelledby="televerser" className="grid gap-3">
        <h2 id="televerser" className="text-lg font-semibold">
          {signature ? 'Remplacer ma signature' : 'Ajouter ma signature'}
        </h2>
        <UploadSignatureForm entityId={entityId} replacing={signature !== null} />
      </section>
    </div>
  )
}

export default function MaSignaturePage({ params }: PageProps<'/espace/[entityId]/ma-signature'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <MySignature params={params} />
    </Suspense>
  )
}
