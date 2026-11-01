---
title: Découpage et ordre des migrations initiales
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Comment découpe-t-on les migrations SQL initiales (livrable « migrations initiales proposées » du README §17) à partir du modèle relationnel et des décisions clos ? À trancher avec l'utilisateur : nombre et ordre des fichiers (extensions et schémas, identité et autorisations, patrimoine et location, finances, documents, apurements et reprise d'historique, audit, RLS, fonctions SQL d'opération, vues du tableau de bord, `pg_cron`, graines), règle de nommage, ce qui appartient au Lot 1 et ce qui peut attendre un lot ultérieur (par exemple tables et fonctions du Lot 3 et du Lot 5), compatibilité avec la règle « expand puis contract » dès la première version, et jeu de départ pour les tests.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Règles**
- **Création progressive** : seules les tables dont un lot a besoin sont créées au début de ce lot. Exceptions créées dès le Lot 1 : `audit_logs` (les fonctions des lots suivants y écrivent) ; les colonnes de reprise d'historique (`external_ref`, `import_batch_id`) sont **incluses dès la création** des tables concernées, et `import_batches` est créée avant elles, au Lot 2.
- **Un sujet par migration** : tables, contraintes, index, triggers et **politiques RLS dans le même fichier**, sans jamais séparer la RLS de la table (le test de garde le vérifie).
- **Schémas et privilèges** : tables de gestion dans `public` avec RLS. Fonctions appelées par l'application en `SECURITY INVOKER` dans `public`, `REVOKE ALL FROM PUBLIC` puis `GRANT EXECUTE` à `authenticated`. Fonctions `SECURITY DEFINER` (consommation d'invitation, purge du journal, anonymisation, tâches `pg_cron`, écriture d'audit) dans un schéma **`app` non exposé** par l'API, avec `SET search_path = ''`, appelées seulement par d'autres fonctions, le module `service_role` ou `pg_cron`. Le test de garde liste les `SECURITY DEFINER` et échoue hors de la liste autorisée.
- **Nommage et sens** : `supabase/migrations/AAAAMMJJHHMMSS_l<lot>_<sujet>.sql` (par exemple `20261201090000_l1_identity.sql`). Migrations **à sens unique** : une erreur se corrige par une nouvelle migration, jamais en modifiant une migration appliquée (staging compris) ; une fonction se modifie par un nouveau `CREATE OR REPLACE` ; `supabase db reset` rejoue tout et doit toujours réussir.
- **Données de référence** (par exemple `role_permissions`) dans les migrations. **Jeu de départ fictif** : script TypeScript `pnpm seed:test` qui crée les utilisateurs par l'API d'administration de Supabase puis insère les lignes par les fonctions SQL ; la CI exécute `supabase start`, `pnpm seed:test`, puis les tests ; le staging reçoit le même jeu fictif sur demande.
- **Livrable de la carte** : un tableau de découpage (fichier, contenu, lot, dépendances) dans la proposition consolidée ; **aucun SQL écrit ici**, le SQL est écrit dans les tickets du backlog, test d'abord.

**Tableau de découpage**

| Lot | Migration (sujet) | Contenu | Dépend de |
|---|---|---|---|
| 0/1 | `extensions_helpers` | extensions, schéma `app`, `app_today`, `set_updated_at`, écriture d'audit | — |
| 1 | `audit` | `audit_logs` en ajout seul, fonction de purge | helpers |
| 1 | `identity` | `profiles`, `ownership_entities`, `entity_memberships`, `role_permissions` et ses données, `has_permission`, triggers du dernier administrateur et de la copie d'e-mail, RLS | audit |
| 1 | `create_entity` | fonction de création de structure, catégories par défaut | identity |
| 2 | `import_batches` | `import_batches`, RLS | identity |
| 2 | `property_tenants` | `properties`, notes de maintenance, codes d'accès, `tenants`, `tenant_private_details`, RLS | import_batches |
| 2 | `leases` | `leases`, `lease_tenants`, `rental_terms`, RLS, rattrapage | property_tenants |
| 3 | `finance_core` | `rent_charges`, `payments`, `payment_allocations`, invariants, immutabilité, vue `rent_charge_balances`, RLS | leases |
| 3 | `finance_functions` | fonctions d'opération (saisie, affectation, déplacement, annulation, recalcul) | finance_core |
| 3 | `finance_cron` | `create_due_rent_charges`, expirations, planification `pg_cron` | finance_functions |
| 3 | `charge_settlements` | `charge_settlements`, fonction de saisie, apurement final | finance_core |
| 4 | `tenant_access` | `invitations`, `tenant_account_links`, consommation d'invitation | identity, leases |
| 4 | `signatures_receipts` | `entity_signatures`, `receipts`, fonction d'émission, numérotation | finance_functions |
| 5 | `expenses` | `expense_categories`, `expenses`, `documents` | identity, property_tenants |
| 5 | `dashboard` | `dashboard_summary`, `dashboard_monthly`, `dashboard_by_property` | finance_core, expenses, charge_settlements |
| Reprise | `history_import` | `cancel_import_batch`, fonctions d'import, `anonymize_tenant` | finance_functions, charge_settlements |

Ajustement issu du ticket clos sur le backlog : la table invitations passe au Lot 1 (migration identity), car le premier administrateur et les membres sont invites des le Lot 1 ; tenant_account_links reste au Lot 4.
