# Arborescence du dépôt

```
src/app/        pages, layouts, Server Actions et Route Handlers (Next.js App Router)
src/domains/    un dossier par domaine métier (voir src/domains/README.md)
src/components/ composants d'interface (shadcn/ui dans components/ui)
src/lib/        utilitaires partagés
supabase/       migrations et graines (à partir de L0-02)
e2e/            tests Playwright (à partir de L0-05)
docs/           proposition, ADR, exploitation, recette, carte wayfinder
```

Commandes : `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Node 22 (voir `.nvmrc`), pnpm.
