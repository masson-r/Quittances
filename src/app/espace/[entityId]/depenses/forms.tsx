'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ActionForm } from '@/components/forms/action-form'
import { FormMessages, SelectField, TextField } from '@/components/forms/fields'
import {
  addCategoryAction,
  cancelExpenseAction,
  createExpenseAction,
  updateCategoryAction,
  updateExpenseAction,
} from '@/domains/expenses/actions'
import { formatEurosInput } from '@/lib/money'

interface Option {
  value: string
  label: string
}

interface ExpenseValues {
  id: string
  propertyId: string
  categoryId: string
  expenseDate: string
  description: string
  amountCents: number
  recoverable: boolean
}

function ExpenseFields({
  state,
  properties,
  categories,
  expense,
  prefix,
}: {
  state: Parameters<typeof SelectField>[0]['state']
  properties: Option[]
  categories: Option[]
  expense?: ExpenseValues
  prefix: string
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="propertyId" label="Bien" options={properties} defaultValue={expense?.propertyId} state={state} idPrefix={prefix} />
        <SelectField name="categoryId" label="Catégorie" options={categories} defaultValue={expense?.categoryId} state={state} idPrefix={prefix} />
        <TextField name="expenseDate" label="Date" type="date" state={state} defaultValue={expense?.expenseDate} idPrefix={prefix} required />
        <TextField
          name="amount"
          label="Montant (€)"
          state={state}
          defaultValue={expense ? formatEurosInput(expense.amountCents) : undefined}
          inputMode="decimal"
          idPrefix={prefix}
          required
        />
      </div>
      <TextField name="description" label="Description" state={state} defaultValue={expense?.description} idPrefix={prefix} required />
      <div className="flex items-center gap-2">
        <input id={`${prefix}recoverable`} name="recoverable" type="checkbox" defaultChecked={expense?.recoverable} className="size-4" />
        <Label htmlFor={`${prefix}recoverable`}>Potentiellement récupérable auprès du locataire</Label>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}document`}>Justificatif (facultatif)</Label>
        <input
          id={`${prefix}document`}
          name="document"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          aria-describedby={`${prefix}document-hint`}
        />
        <p id={`${prefix}document-hint`} className="text-muted-foreground text-sm">
          PDF, PNG ou JPEG, 5 Mo au maximum.
        </p>
      </div>
    </>
  )
}

export function CreateExpenseForm({ entityId, properties, categories }: { entityId: string; properties: Option[]; categories: Option[] }) {
  return (
    <ActionForm action={createExpenseAction} className="grid max-w-2xl gap-4">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <FormMessages state={state} />
          <ExpenseFields state={state} properties={properties} categories={categories} prefix="new-" />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer la dépense'}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function EditExpenseForm({ entityId, expense, properties, categories }: { entityId: string; expense: ExpenseValues; properties: Option[]; categories: Option[] }) {
  return (
    <ActionForm action={updateExpenseAction} className="grid gap-4">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="expenseId" value={expense.id} />
          <FormMessages state={state} />
          <ExpenseFields state={state} properties={properties} categories={categories} expense={expense} prefix={`${expense.id}-`} />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Enregistrer les modifications de ${expense.description}`}>
              Enregistrer les modifications
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function CancelExpenseForm({ entityId, expenseId, label }: { entityId: string; expenseId: string; label: string }) {
  return (
    <ActionForm action={cancelExpenseAction} className="grid gap-2">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <FormMessages state={state} />
          <TextField name="reason" label="Motif de l'annulation" state={state} idPrefix={`c${expenseId}`} required />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Annuler la dépense ${label}`}>
              Annuler la dépense
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function AddCategoryForm({ entityId }: { entityId: string }) {
  return (
    <ActionForm action={addCategoryAction} className="flex flex-wrap items-end gap-3">
      {(state, pending) => (
        <>
          <input type="hidden" name="entityId" value={entityId} />
          <div className="grid gap-1.5">
            <TextField name="name" label="Nouvelle catégorie" state={state} idPrefix="cat-new-" required />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Ajouter
          </Button>
          <FormMessages state={state} />
        </>
      )}
    </ActionForm>
  )
}

export function CategoryRow({ entityId, category }: { entityId: string; category: { id: string; name: string; archived: boolean } }) {
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="category">
      {!category.archived && (
        <ActionForm action={updateCategoryAction} className="flex flex-wrap items-end gap-2">
          {(state, pending) => (
            <>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="categoryId" value={category.id} />
              <TextField name="name" label={`Nom de la catégorie ${category.name}`} state={state} defaultValue={category.name} idPrefix={`cat-${category.id}-`} />
              <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Renommer ${category.name}`}>
                Renommer
              </Button>
              <FormMessages state={state} />
            </>
          )}
        </ActionForm>
      )}
      {category.archived && <span className="text-muted-foreground text-sm">{category.name} (archivée)</span>}
      <ActionForm action={updateCategoryAction} className="flex items-end">
        {(state, pending) => (
          <>
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="categoryId" value={category.id} />
            <input type="hidden" name="archive" value={category.archived ? '0' : '1'} />
            <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`${category.archived ? 'Rétablir' : 'Archiver'} ${category.name}`}>
              {category.archived ? 'Rétablir' : 'Archiver'}
            </Button>
            <FormMessages state={state} />
          </>
        )}
      </ActionForm>
    </div>
  )
}
