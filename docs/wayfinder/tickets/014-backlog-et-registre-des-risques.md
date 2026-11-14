---
title: Backlog priorisé, dépendances et registre des risques
type: grilling
status: closed
assignee: massonr
blocked_by:
  - 013-decoupage-migrations-initiales.md
---

## Question

Quel est le backlog final de réalisation et le registre des risques qui complètent la proposition initiale (README §17) ? À trancher avec l'utilisateur, à partir de toutes les décisions closes :
- découpage des Lots 0 à 6 du README §11 en tickets indépendants, dans un ordre justifié, avec dépendances entre tickets et critères d'acceptation reprenant `docs/definition-of-done.md` ;
- place de la reprise d'historique (script d'import), de la signature, des apurements et du tableau de bord dans les lots ;
- jalons avant la première utilisation réelle : recette signée, sauvegardes (risque accepté), durée de conservation comptable côté bailleur à confirmer, et points à vérifier de la recherche juridique (texte de l'article 21, L. 112-6 et L. 112-7, article 8-1) ;
- registre des risques techniques et métier : risque, probabilité, effet, mesure, propriétaire ;
- forme finale de la proposition consolidée à valider.

Decision issue du ticket clos sur les migrations : le tableau de decoupage (lot, migration, dependances) sert de base au decoupage du backlog ; le SQL est ecrit dans les tickets du backlog, test dabord ; le script seed:test et le jalon supabase db reset sont des taches du Lot 0.

## Résolution

**Provenance** : l'utilisateur a répondu d'avance « oui à mes recommandations » en invoquant ce ticket ; le backlog et le registre ci-dessous sont donc mes recommandations, enregistrées comme acceptées. Ils seront relus dans la proposition consolidée, que l'utilisateur doit valider avant tout code (README §17).

**Principes**
- Chemin critique : Lot 0 → 1 → 2 → 3 → 4, puis 5, puis reprise d'historique, puis Lot 6. Les tickets sans dépendance mutuelle peuvent être menés en parallèle (indiqué dans « dépend de »).
- **Critères d'acceptation communs à chaque ticket** : `docs/definition-of-done.md` (tests pertinents verts, règles côté serveur et en fonctions SQL pour les écritures multiples, RLS et ligne de matrice pour toute nouvelle table, entrée d'audit pour toute opération sensible, migration compatible avec le schéma précédent, interface en français avec contrôle d'accessibilité, aucun secret ni donnée personnelle, documentation et ADR si nécessaire) ; les critères ci-dessous s'y **ajoutent**.
- **Ajustement du tableau de découpage des migrations** : la table `invitations` passe au Lot 1 (invitation du premier administrateur et des membres) ; `tenant_account_links` reste au Lot 4.
- Aucun SQL n'est écrit par cette carte : chaque ticket écrit ses tests d'abord.

**Backlog** (T = tests d'intégration, E = end-to-end)

*Lot 0 — Initialisation technique*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L0-01 | Projet Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, pnpm, Node LTS fixé, ESLint, arborescence par domaine | — | `pnpm dev` démarre ; `tsc` et lint passent ; arborescence documentée |
| L0-02 | Supabase local (CLI, Docker) et migration `extensions_helpers` (`app_today`, `set_updated_at`, schéma `app`) | L0-01 | `supabase start` puis `db reset` réussissent ; `app_today` n'accepte une date imposée qu'avec `app.environment = test` |
| L0-03 | CI GitHub Actions : typage, lint, Vitest, Supabase local, build ; contrôle des migrations destructives ; protection de `main` | L0-01, L0-02 | une PR échoue si un contrôle échoue ; `DROP`, `RENAME`, `TRUNCATE` refusés sans annotation `-- contract:` |
| L0-04 | Environnements : projets Supabase staging et production (`eu-west-3`, Pro), Vercel `cdg1`, branche `production`, workflow manuel de migration, secrets, `.env.example` | L0-03 | `main` déploie le staging ; production déployée après migration approuvée ; aucun secret dans le dépôt |
| L0-05 | Outillage de test : Vitest (unitaires, intégration), `fast-check`, Playwright, squelette `pnpm seed:test`, `docs/definition-of-done.md` | L0-02 | un test de chaque niveau passe en CI |
*Jalon L0 : le projet démarre localement et se déploie sur le staging.*

*Lot 1 — Authentification et structures*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L1-01 | Migrations `audit` (ajout seul, purge) ; matrice déclarative de RLS et test de garde (RLS activée, liste des `SECURITY DEFINER`) | L0-05 | `UPDATE` et `DELETE` refusés sur `audit_logs` ; test de garde échoue sur une table sans RLS |
| L1-02 | Migrations `identity` : `profiles`, `ownership_entities`, `entity_memberships`, `role_permissions`, `has_permission`, `invitations` ; triggers du dernier administrateur et de la copie d'e-mail | L1-01 | T : cloisonnement par structure et rôle ; dernier administrateur protégé |
| L1-03 | Authentification : inscription, vérification d'e-mail, connexion, réinitialisation, sessions ; droits relus en base à chaque requête ; profil désactivé | L1-02 | T : désactivation immédiate ; E : parcours de connexion |
| L1-04 | TOTP obligatoire pour l'administrateur et le gestionnaire, codes de secours | L1-03 | accès refusé sans second facteur ; réinitialisation par l'opérateur documentée |
| L1-05 | Script `operator:create-structure` et fonction de création de structure (catégories par défaut, premier administrateur invité) | L1-02 | trace dans `audit_logs` ; `service_role` hors application seulement |
| L1-06 | Gestion des membres : invitations (lien à adresse vérifiée), rôles, suspension | L1-03, L1-05 | T : invitation liée à l'e-mail vérifié ; E : invitation d'un membre |
| L1-07 | Squelette de l'interface propriétaire : navigation, sélecteur de structure, mise en page responsive en français | L1-03 | `axe` sans violation critique ; mobile 390 px |
*Jalon L1 : aucun utilisateur n'accède aux données d'une structure non autorisée.*

*Lot 2 — Biens, locataires et baux*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L2-01 | Migrations `import_batches` et `property_tenants` avec RLS | L1-02 | T : matrice de RLS ; champs sensibles réservés à l'administrateur et au gestionnaire |
| L2-02 | Biens : création, modification, archivage, notes de maintenance en ajout seul, codes d'accès restreints | L2-01, L1-07 | un bien avec historique n'est jamais supprimé |
| L2-03 | Dossiers locataires et données privées (garant, aide au logement, date de naissance) | L2-01, L1-07 | le lecteur ne voit aucune donnée sensible |
| L2-04 | Migration `leases` et baux : conditions de loyer, colocataires avec périodes de présence, chevauchement interdit | L2-02, L2-03 | T : unicité des versions de conditions ; colocation avec entrée et sortie |
| L2-05 | Fiche du bail et historique des occupations d'un bien | L2-04 | plusieurs baux successifs sans perte d'historique |
*Jalon L2 : plusieurs locataires et plusieurs baux successifs gérés sans perte d'historique.*

*Lot 3 — Échéances, paiements et apurements*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L3-01 | Fonctions financières pures : prorata, arrondis, date d'échéance (jours 29 à 31), statuts | L0-05 | 100 % des branches ; tests à propriétés `fast-check` |
| L3-02 | Migration `finance_core` : `rent_charges`, `payments`, `payment_allocations`, invariants, immutabilité, vue `rent_charge_balances` | L2-04, L3-01 | T : concurrence (deux saisies simultanées), suppression refusée y compris `service_role` |
| L3-03 | Migration `finance_functions` : saisie de paiement, affectation proposée puis validée, déplacement, annulation, recalcul et annulation d'échéance | L3-02 | T : chaque fonction transactionnelle ; audit de chaque opération |
| L3-04 | `pg_cron` : `create_due_rent_charges` (idempotente, rattrapage) et expirations | L3-03 | T : horloge de test, rejeu sans doublon, rattrapage d'un bail ancien |
| L3-05 | Interface des échéances et paiements : saisie, affectation, corrections tracées, avertissement espèces | L3-03, L1-07 | E : paiement partiel puis complément |
| L3-06 | Page Impayés : retard en jours, paiements reçus, liens vers les baux | L3-04 | statut calculé le lendemain de la date d'échéance |
| L3-07 | Apurement des charges : migration `charge_settlements`, fonction, interface, apurement final et alerte | L3-02 | T : montant signé, zéro réservé à l'apurement final, anonymisation bloquée sans apurement final |
*Jalon L3 : montants et statuts exacts dans tous les scénarios testés.*

*Lot 4 — Portail locataire et quittances*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L4-01 | Rattachement : migration `tenant_access`, consommation d'invitation avec limitation de débit, demande, validation, refus, révocation, retrait du consentement, expiration | L1-06, L2-03 | T : message unique pour tout lien invalide ; jamais de rattachement par e-mail seul |
| L4-02 | Espace locataire : inscription, Mon espace, demandes, coordonnées, résumé des baux, mobile | L4-01 | E sur mobile ; le locataire ne voit ni échéances, ni paiements, ni soldes |
| L4-03 | Signature du bailleur : migration `member_signatures`, téléversement par chaque membre de sa propre signature, validation de l'image | L1-02 | PNG ou JPEG, 500 Ko, 1 200 × 600 pixels, EXIF supprimé |
| L4-04 | Quittances et reçus : migration `receipts`, émission (dates modifiables), numérotation, PDF variante C côté serveur, stockage privé, empreinte SHA-256, annulation et remplacement | L3-03, L4-03, L0-04 | tests d'extraction de texte du PDF ; une quittance active par échéance ; PDF jamais régénéré |
| L4-05 | Téléchargement sécurisé : route serveur, lien de 60 secondes, module `service_role` limité | L4-04, L4-01 | accès direct au bucket refusé ; lien expiré refusé |
*Jalon L4 : chaque locataire accède exclusivement aux documents qui lui sont destinés.*

*Lot 5 — Dépenses et tableau de bord*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L5-01 | Migration `expenses` et interface : catégories par structure, justificatifs, filtres | L2-02 | catégories modifiables par l'administrateur seul |
| L5-02 | Migration `dashboard` : trois fonctions SQL sous RLS | L3-07, L5-01 | T : concordance avec le recalcul depuis les tables brutes |
| L5-03 | Interface du tableau de bord : bandeau, évolution mensuelle, comparaison par bien, dernières opérations, filtres dont 1, 2, 3 et 5 ans, vue consolidée | L5-02 | mention « n'est pas un résultat fiscal » ; compteur d'apurement final |
*Jalon L5 : les indicateurs concordent avec les données financières de référence.*

*Lot R — Reprise d'historique*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| LR-01 | Migration `history_import`, script d'import CSV avec `--dry-run`, rapport de totaux, rejeu sans doublon, lot tout ou rien, annulation d'un lot | L3-07, L5-01 | T : fixtures fictives de cinq ans pour trois baux ; rejet complet au moindre échec |
| LR-02 | Fin de vie des données : `anonymize_tenant` manuelle (3 ans) et purge du journal | L3-07 | anonymisation refusée sans apurement final |
*Jalon R : un `--dry-run` sur les vrais fichiers donne des totaux conformes aux documents de l'utilisateur.*

*Lot 6 — Recette et production*
| Réf. | Ticket | Dépend de | Critères propres |
|---|---|---|---|
| L6-01 | Six parcours Playwright, bureau et mobile, avec `axe` | L4-05, L5-03 | durée de CI inférieure à dix minutes |
| L6-02 | Tests d'accès non autorisés complets et test de volumétrie de dix ans pour trois baux | L5-03, L4-05 | réponses inférieures à 500 ms ; matrice complète verte |
| L6-03 | Documentation de production : exploitation, accès direct de l'opérateur, déploiement, accord de sous-traitance (art. 28) | L0-04 | un développeur reprend le projet sans contexte de conversation |
| L6-04 | Tâche humaine : lever les jalons ouverts (durée de conservation comptable, relecture de l'article 21 sur Légifrance, L. 112-6, L. 112-7, article 8-1, décision sur les sauvegardes avant données réelles) | — | décisions consignées dans des ADR |
| L6-05 | Revue visuelle de la variante C et recette signée dans `docs/recette.md` | L6-01, L6-02, L6-03, L6-04, LR-01 | recette signée et datée avant toute utilisation réelle |
*Jalon L6 : tous les tests bloquants passent et le déploiement de production est documenté.*

**Registre des risques** (propriétaire par défaut : l'utilisateur, également opérateur)
| Réf. | Risque | Probabilité | Effet | Mesure |
|---|---|---|---|---|
| R1 | Erreur de calcul financier (prorata, arrondi, affectation) | Moyenne | Élevé | fonctions pures à 100 % des branches, `fast-check`, invariants en base, recette |
| R2 | Fuite de données entre structures ou entre locataires par une RLS erronée | Faible | Critique | clés composites, matrice déclarative, test de garde, droits relus à chaque requête |
| R3 | **Perte de données : Storage non sauvegardé, aucune restauration testée (risque accepté, ADR 0007)** | Moyenne | Élevé | risque accepté le 14/11/2026 ; à revoir au premier incident ; PDF remplaçables par annulation puis nouvelle émission |
| R4 | Durée de conservation comptable incertaine, anonymisation prématurée ou tardive | Moyenne | Moyen | fonction manuelle, jalon L6-04 |
| R5 | Mauvaise lecture des textes (quittance, consentement, mention « signé électroniquement » sans valeur de signature qualifiée) | Moyenne | Moyen | relecture Légifrance, formulation prudente, consentement stocké |
| R6 | Reprise d'historique erronée ou incomplète | Moyenne | Élevé | `--dry-run`, rapport de totaux, tout ou rien, annulation d'un lot |
| R7 | Dépendance aux fournisseurs (région Vercel par défaut hors UE, pause d'un projet gratuit, limites d'offre) | Moyenne | Moyen | `cdg1`, offre Pro en production, vérification en recette |
| R8 | Continuité : une seule personne est propriétaire, opérateur et développeur ; perte du second facteur | Faible | Moyen | codes de secours, réinitialisation documentée, documentation de reprise |
| R9 | Complexité SQL (fonctions, triggers) difficile à maintenir | Moyenne | Moyen | migrations à sens unique, tests d'intégration, ADR |
| R10 | Régression de schéma ou de RLS en production | Faible | Élevé | migration de production manuelle et approuvée, expand puis contract, staging |
| R11 | Génération des PDF en environnement serverless (mémoire, polices) | Faible | Moyen | bibliothèque sans navigateur, validation dès L4-04 |
| R12 | Dérive du périmètre MVP | Moyenne | Moyen | liste « hors périmètre » de la carte, backlog par lot |
| R13 | Fuite des fichiers CSV de reprise | Faible | Élevé | fichiers sur le poste de l'opérateur, hors dépôt et CI, suppression après contrôle |
| R14 | Erreurs de date (Paris et UTC, changement d'heure) | Moyenne | Faible | `app_today()`, dates métier en `date`, tests dédiés |

**Forme de la proposition consolidée** : un document `docs/proposition-initiale.md` suivant le README §17, assemblé à partir des tickets clos : architecture technique, diagramme relationnel (Mermaid), tableau de découpage des migrations, matrice des autorisations, parcours utilisateurs, règles financières, backlog et dépendances, critères d'acceptation, stratégie de test, risques. ADR candidats (difficiles à renverser, surprenants, issus d'un vrai compromis) : soldes calculés et jamais stockés ; `entity_id` et clés composites ; opérations financières en fonctions SQL ; PDF immuable avec empreinte ; sauvegardes reportées. L'assemblage n'est pas une décision : il est fait dans une session distincte, puis soumis à la validation de l'utilisateur.
