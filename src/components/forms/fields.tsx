'use client'

import { useId } from 'react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormState } from '@/lib/form-state'

interface FieldProps {
  name: string
  label: string
  state: FormState
  type?: string
  defaultValue?: string | number | null
  hint?: string
  required?: boolean
  autoComplete?: string
  inputMode?: 'numeric' | 'text' | 'decimal' | 'email' | 'tel'
  multiline?: boolean
  /** Identifiant unique quand plusieurs formulaires de la page ont un champ du même nom. */
  idPrefix?: string
}

/** Champ de formulaire accessible : libellé, aide et erreur reliés au champ. */
export function TextField({ name, label, state, type = 'text', defaultValue, hint, required, autoComplete, inputMode, multiline, idPrefix = '' }: FieldProps) {
  // Identifiant unique par instance : Next conserve les pages quittées dans le DOM, deux champs du même nom ne doivent pas partager d'id.
  const uid = useId()
  const id = `${idPrefix}${name}${uid}`
  const errors = state.fieldErrors?.[name]
  const describedBy = [errors ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          defaultValue={state.values?.[name] ?? defaultValue ?? ''}
          required={required}
          aria-invalid={errors ? true : undefined}
          aria-describedby={describedBy}
          className="border-input bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm"
        />
      ) : (
        <Input
          id={id}
          name={name}
          type={type}
          defaultValue={state.values?.[name] ?? defaultValue ?? ''}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={errors ? true : undefined}
          aria-describedby={describedBy}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {errors && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  state,
  idPrefix = '',
}: {
  name: string
  label: string
  options: { value: string; label: string }[]
  defaultValue?: string
  state: FormState
  idPrefix?: string
}) {
  const uid = useId()
  const id = `${idPrefix}${name}${uid}`
  const errors = state.fieldErrors?.[name]
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        // La clé force un nouveau champ quand la valeur renvoyée change : défaut d'un <select> déjà monté non réappliqué.
        key={state.values?.[name] ?? 'initial'}
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaultValue}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${id}-error` : undefined}
        className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {errors && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

/** Erreur générale (rôle alert) et confirmation (rôle status) d'un formulaire. */
export function FormMessages({ state, children }: { state: FormState; children?: ReactNode }) {
  return (
    <>
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <p role="status" className="text-sm">
          {state.success}
        </p>
      )}
      {children}
    </>
  )
}
