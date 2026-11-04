# Critères d'acceptation communs

Un ticket n'est terminé que si, en plus de ses critères propres :

- Les tests pertinents sont verts : unitaires (`pnpm test`), intégration (`pnpm test:integration`, base locale), de base (`pnpm db:test`) et de bout en bout (`pnpm test:e2e`) selon ce que le ticket touche. Un test est écrit avant le code.
- Les règles financières s'appliquent côté serveur ; les écritures sur plusieurs lignes passent par une fonction SQL (ADR 0003).
- Toute nouvelle table ou colonne sensible a sa politique RLS et sa ligne dans la matrice des autorisations.
- Toute opération sensible écrit une entrée d'audit.
- La migration reste compatible avec le schéma précédent d'une version, et passe `pnpm check:migrations`.
- Les messages et l'interface sont en français ; toute nouvelle page passe un contrôle d'accessibilité.
- Aucun secret ni donnée personnelle dans le code, les journaux ou le jeu de départ.
- `pnpm typecheck`, `pnpm lint` et `pnpm build` passent.

## Outillage de test

| Niveau | Commande | Emplacement |
|---|---|---|
| Unitaire (Vitest, `fast-check`) | `pnpm test` | `src/**/*.test.ts` |
| Intégration sur Supabase local | `pnpm test:integration` | `tests/integration/` |
| Base (pgTAP) | `pnpm db:test` | `supabase/tests/database/` |
| Bout en bout (Playwright) | `pnpm test:e2e` | `e2e/` |
| Scripts | `pnpm test:scripts` | `scripts/*.test.mjs` |

`pnpm seed:test` prépare la base locale (fixe `app.environment = 'test'`) et refuse tout hôte non local. Le jeu de données fictif s'y ajoutera avec les lots suivants. Les tests d'intégration lisent `DATABASE_URL` (défaut : base locale) et s'exécutent dans une transaction annulée.

## Matrice RLS et test de garde

`tests/integration/rls-matrix.ts` déclare, pour chaque table du schéma `public`, ce que chaque rôle (`anon`, `authenticated`, `service_role`) peut faire en lecture, insertion, modification et suppression. `rls.test.ts` génère un test par case. Le test de garde échoue si :

- une table de `public` n'a pas la RLS activée ;
- une table de `public` manque dans la matrice ;
- une fonction `SECURITY DEFINER` est hors de la liste `ALLOWED_SECURITY_DEFINER`, hors du schéma `app`, ou sans `search_path` vide.

Toute migration qui ajoute une table ou une fonction `SECURITY DEFINER` met à jour ce fichier dans la même modification.
