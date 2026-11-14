# Arborescence du dépôt

```
src/app/        pages, layouts, Server Actions et Route Handlers (Next.js App Router)
src/domains/    un dossier par domaine métier (voir src/domains/README.md)
src/components/ composants d'interface (shadcn/ui dans components/ui, app-shell/ pour le menu et le sélecteur de structure)
src/lib/        utilitaires partagés
supabase/       migrations, tests de base (pgTAP, supabase/tests/database) et graines
e2e/            tests Playwright (à partir de L0-05)
docs/           proposition, ADR, exploitation, recette, carte wayfinder
```

Commandes : `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm build` ; base locale (Docker requis) : `pnpm db:start`, `pnpm db:reset`, `pnpm db:test`, `pnpm db:stop`. Node 22 (voir `.nvmrc`), pnpm.

## Espace propriétaire

- `/espace` : accueil, liste des structures dont on est membre.
- `/espace/<structure>/<section>` : une structure, avec menu (tableau de bord, biens, locataires, baux, échéances et paiements, quittances, dépenses, membres). Une section n'apparaît que si l'utilisateur a la permission de lecture (`public.my_permissions`) ; sinon la page est introuvable.
- Sections pas encore construites : `SectionPlaceholder` (`src/components/app-shell`), à remplacer ticket par ticket. Une section qui ouvre un nouveau domaine l'ajoute à `NAV_ITEMS` (`src/domains/identity/navigation.ts`).
- Chaque page de section commence par `requireSection(entityId, slug)` (`src/domains/identity/entity-access.ts`).
- Mobile (moins de 768 px) : le menu se replie derrière le bouton « Menu ». Tests : `e2e/ui-shell.spec.ts` (axe sur bureau et mobile 390 px).

## Exploitation

Voir `docs/exploitation/` : [production.md](exploitation/production.md) (reprise du projet, accès direct, incidents), [environnements.md](exploitation/environnements.md), [operateur.md](exploitation/operateur.md), [reprise-historique.md](exploitation/reprise-historique.md), [accord-sous-traitance.md](exploitation/accord-sous-traitance.md) et la liste de [recette](recette.md).
