'use client'

import { useActionState, useEffect, useRef, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from 'react'
import type { FormState } from '@/lib/form-state'

const noop = () => () => {}

/**
 * Formulaire relié à une Server Action.
 * - Les champs gardent leurs valeurs après une erreur (React vide sinon les champs d'un formulaire à la fin de l'action,
 *   ce qui désynchronisait aussi les champs pilotés par l'état) ; ils sont vidés après un succès.
 * - `data-hydrated` passe à « true » quand la page est interactive (les tests de bout en bout n'agissent qu'à ce moment-là).
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
  const [state, dispatch, pending] = useActionState(action, {} as FormState)
  const [, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )

  useEffect(() => {
    if (state.success) formRef.current?.reset()
  }, [state])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => dispatch(data))
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} data-hydrated={hydrated} noValidate>
      {children(state, pending)}
    </form>
  )
}
