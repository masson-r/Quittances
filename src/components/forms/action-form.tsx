'use client'

import { useActionState, useSyncExternalStore, type ReactNode } from 'react'
import type { FormState } from '@/lib/form-state'

const noop = () => () => {}

/**
 * Formulaire relié à une Server Action. `data-hydrated` passe à « true » quand la page est interactive
 * (les tests de bout en bout n'agissent qu'à ce moment-là).
 */
export function ActionForm({
  action,
  className = 'grid gap-4',
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  className?: string
  children: (state: FormState, pending: boolean) => ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState)
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  return (
    <form action={formAction} className={className} data-hydrated={hydrated} noValidate>
      {children(state, pending)}
    </form>
  )
}
