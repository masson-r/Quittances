'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { sectionFromPath, sectionHref, type NavItem } from '@/domains/identity/navigation'

export interface EntityOption {
  id: string
  name: string
}

/**
 * Sélecteur de structure et menu des sections.
 * Sur mobile le menu se replie derrière un bouton ; il se referme dès que l'adresse change.
 */
export function EntityNav({ entityId, entities, items }: { entityId: string; entities: EntityOption[]; items: NavItem[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === pathname
  const listId = useId()
  const selectId = useId()
  const current = sectionFromPath(pathname)

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        {entities.length > 1 ? (
          <>
            <Label htmlFor={selectId}>Structure</Label>
            <select
              id={selectId}
              value={entityId}
              onChange={(event) => router.push(sectionHref(event.target.value, current))}
              className="border-input bg-background h-10 w-full rounded-md border px-2 text-sm"
            >
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="text-muted-foreground text-xs font-medium uppercase">Structure</span>
            <span className="font-semibold">{entities[0]?.name}</span>
          </>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        className="md:hidden"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpenFor(open ? null : pathname)}
      >
        Menu
      </Button>

      <nav aria-label="Navigation principale" id={listId} className={open ? 'block' : 'hidden md:block'}>
        <ul className="grid gap-1">
          {items.map((item) => {
            const active = item.slug === current && pathname.startsWith(sectionHref(entityId, item.slug))
            return (
              <li key={item.slug}>
                <Link
                  href={sectionHref(entityId, item.slug)}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md px-3 py-2 text-sm ${active ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted'}`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
