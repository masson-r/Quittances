import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSection } from '@/domains/identity/entity-access'
import { listCategories, listExpenses } from '@/domains/expenses/service'
import { listProperties } from '@/domains/properties/service'
import { isValidIsoDate, formatDateFr } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { AddCategoryForm, CancelExpenseForm, CategoryRow, CreateExpenseForm, EditExpenseForm } from './forms'

export const metadata: Metadata = { title: 'Dépenses — Loyo-reg' }

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function Expenses({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { entityId } = await params
  const query = await searchParams
  const { entityName, permissions } = await requireSection(entityId, 'depenses')
  const canWrite = permissions.includes('expense:write')
  const canCancel = permissions.includes('expense:cancel')
  const canManageCategories = permissions.includes('expense_category:write')

  const propertyId = first(query.bien)
  const categoryId = first(query.categorie)
  const from = first(query.du)
  const to = first(query.au)
  const filters = {
    propertyId: propertyId && uuidLike.test(propertyId) ? propertyId : undefined,
    categoryId: categoryId && uuidLike.test(categoryId) ? categoryId : undefined,
    from: from && isValidIsoDate(from) ? from : undefined,
    to: to && isValidIsoDate(to) ? to : undefined,
    includeCancelled: first(query.annulees) === '1',
  }

  const [expenses, properties, allCategories] = await Promise.all([
    listExpenses(entityId, filters),
    listProperties(entityId, false),
    listCategories(entityId, true),
  ])
  const activeCategories = allCategories.filter((c) => !c.archivedAt)
  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.label }))
  const categoryOptions = activeCategories.map((c) => ({ value: c.id, label: c.name }))
  const total = expenses.filter((e) => !e.cancelledAt).reduce((n, e) => n + e.amountCents, 0)

  return (
    <div className="grid gap-10">
      <header>
        <h1 className="text-2xl font-semibold">Dépenses</h1>
        <p className="text-muted-foreground">{entityName}</p>
      </header>

      {canWrite && (
        <section aria-labelledby="nouvelle" className="grid gap-3">
          <h2 id="nouvelle" className="text-lg font-semibold">
            Nouvelle dépense
          </h2>
          {properties.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              Créez d&apos;abord un bien dans{' '}
              <Link href={`/espace/${entityId}/biens`} className="underline">
                Biens
              </Link>
              .
            </p>
          ) : (
            <CreateExpenseForm entityId={entityId} properties={propertyOptions} categories={categoryOptions} />
          )}
        </section>
      )}

      <section aria-labelledby="liste" className="grid gap-4">
        <h2 id="liste" className="text-lg font-semibold">
          Dépenses enregistrées
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrer les dépenses">
          <label className="grid gap-1 text-sm">
            Bien
            <select name="bien" defaultValue={filters.propertyId ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="">Tous</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Catégorie
            <select name="categorie" defaultValue={filters.categoryId ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="">Toutes</option>
              {allCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archivedAt ? ' (archivée)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Du
            <input type="date" name="du" defaultValue={filters.from ?? ''} className="border-input bg-background h-9 rounded-md border px-2" />
          </label>
          <label className="grid gap-1 text-sm">
            Au
            <input type="date" name="au" defaultValue={filters.to ?? ''} className="border-input bg-background h-9 rounded-md border px-2" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="annulees" value="1" defaultChecked={filters.includeCancelled} className="size-4" />
            Afficher les annulées
          </label>
          <button type="submit" className="border-input bg-background h-9 rounded-md border px-3 text-sm">
            Filtrer
          </button>
        </form>

        <p className="text-sm" data-testid="expenses-total">
          {expenses.filter((e) => !e.cancelledAt).length} dépense(s) · total <strong>{formatCents(total)}</strong>
        </p>

        {expenses.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">Aucune dépense pour cette sélection.</p>
        ) : (
          <ul className="grid gap-3">
            {expenses.map((e) => (
              <li key={e.id} className="grid gap-2 rounded-lg border p-3" data-testid="expense">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{e.description}</span>
                  <span className="text-sm font-medium" data-testid="expense-amount">
                    {formatCents(e.amountCents)}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  {formatDateFr(e.expenseDate)} · {e.propertyLabel} · {e.categoryName}
                  {e.recoverable ? ' · potentiellement récupérable' : ''}
                  {e.cancelledAt ? ` · ANNULÉE (${e.cancellationReason})` : ''}
                </p>
                {e.documentId && (
                  <a href={`/justificatifs/${e.documentId}`} className="w-fit text-sm underline" aria-label={`Voir le justificatif de ${e.description}`}>
                    Voir le justificatif
                  </a>
                )}
                {!e.cancelledAt && (canWrite || canCancel) && (
                  <details className="text-sm">
                    <summary className="w-fit cursor-pointer underline">Modifier ou annuler</summary>
                    <div className="mt-3 grid max-w-2xl gap-5">
                      {canWrite && (
                        <EditExpenseForm
                          entityId={entityId}
                          expense={{
                            id: e.id,
                            propertyId: e.propertyId,
                            categoryId: e.categoryId,
                            expenseDate: e.expenseDate,
                            description: e.description,
                            amountCents: e.amountCents,
                            recoverable: e.recoverable,
                          }}
                          properties={propertyOptions}
                          categories={categoryOptions}
                        />
                      )}
                      {canCancel && <CancelExpenseForm entityId={entityId} expenseId={e.id} label={e.description} />}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageCategories && (
        <section aria-labelledby="categories" className="grid gap-3">
          <h2 id="categories" className="text-lg font-semibold">
            Catégories
          </h2>
          <p className="text-muted-foreground text-sm">Réservé à l&apos;administrateur. Une catégorie archivée reste visible sur les dépenses existantes.</p>
          <ul className="grid gap-3">
            {allCategories.map((c) => (
              <li key={c.id}>
                <CategoryRow entityId={entityId} category={{ id: c.id, name: c.name, archived: c.archivedAt !== null }} />
              </li>
            ))}
          </ul>
          <AddCategoryForm entityId={entityId} />
        </section>
      )}
    </div>
  )
}

export default function Page({ params, searchParams }: PageProps<'/espace/[entityId]/depenses'>) {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <Expenses params={params} searchParams={searchParams} />
    </Suspense>
  )
}
