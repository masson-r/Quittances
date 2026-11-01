---
title: Stratégie de test et critères d'acceptation transverses
type: grilling
status: closed
assignee: massonr
blocked_by:
  - 003-regles-financieres.md
  - 004-matrice-autorisations.md
  - 008-architecture-technique.md
---

## Question

Comment prouve-t-on que le système est correct ? À trancher avec l'utilisateur : répartition entre tests unitaires (règles financières), d'intégration (services, RLS, frontières de sécurité) et end-to-end (parcours critiques, mobile), jeux de données de référence, scénarios d'accès non autorisés entre structures, locataires et baux, contrôles bloquants de la CI GitHub Actions, et critères d'acceptation communs à tous les tickets du backlog.

Cas imposés par le ticket clos sur les règles financières : rattrapage sans doublon, prorata et arrondis, jours d'échéance 29 à 31, changement de conditions, paiement en avance non affecté, déplacement d'affectation, annulation de paiement avec quittance, recalcul et annulation d'échéance, bascule en retard le lendemain.

Cas imposés par le ticket clos sur les autorisations : chaque rôle contre chaque ressource de la matrice ; aucun cumul de droits entre contextes ; locataire sans accès aux échéances, paiements et soldes ; révocation et désactivation avec effet immédiat ; lien de téléchargement expiré ; accès direct au bucket refusé ; retrait ou rétrogradation du dernier administrateur refusé ; absence de politique de suppression.

Cas imposés par le ticket clos sur le rattachement : lien réutilisé, expiré, révoqué ou inconnu avec message identique ; limitation de débit ; rattachement jamais créé sur e-mail identique ; deuxième rattachement actif sur un même dossier refusé ; colocataire sans accès au dossier d'un autre ; invitation de membre refusée si l'e-mail vérifié diffère ; retrait du consentement ; expiration à 30 jours.

Cas imposés par le ticket clos sur la mise en page PDF : image de signature refusée si le type ou la taille est invalide ; signature présente dans la quittance émise et figée ensuite ; mention « signé électroniquement » et identifiant du document présents ; rendu du reçu partiel distinct de la quittance ; montant en lettres correct (cas 71, 80, 97, centimes).

Décisions issues du ticket clos sur l'architecture : CI sur chaque pull request avec TypeScript, ESLint, Vitest unitaires, intégration sur Supabase local (RLS et isolation), build et Playwright sur pile locale, tous bloquants, `main` protégée ; tests de sécurité en Vitest avec un client par utilisateur de test (pas de pgTAP) ; à couvrir en plus : idempotence des fonctions `pg_cron`, invariants des fonctions SQL, empreinte du PDF stocké, compatibilité du code avec le schéma précédent, TOTP obligatoire. Aucun test de restauration au MVP (risque accepté).

Cas imposes par le ticket clos sur le modele relationnel : lien entre deux structures refuse par cles composites ; depassement de montant par deux saisies simultanees ; suppression refusee pour service_role sur les tables financieres et documentaires ; colonnes non modifiables apres creation ; audit_logs en ajout seul et sans donnees personnelles ; une seule quittance active par echeance ; signature invalide refusee (type, taille, dimensions) ; document sans signature ; dernier administrateur protege ; anonymize_tenant limite a 3 ans apres le dernier bail ; vue rent_charge_balances sous RLS ; periode de presence des colocataires dans la quittance.

## Résolution

Décidé avec l'utilisateur, en grilling. Les cas à tester imposés par les tickets précédents (listés ci-dessus) font partie du périmètre de cette stratégie.

**Niveaux et règles**
- **Unitaires (Vitest)** : fonctions financières pures (prorata, arrondis, statuts, montant en lettres), sans base ni réseau, plus **tests à propriétés** avec `fast-check` (outil de développement) sur les invariants monétaires : la somme des prorata ne dépasse jamais l'échéance, une affectation ne dépasse jamais un solde.
- **Intégration (Vitest sur Supabase local)** : chaque fonction SQL d'opération, chaque trigger, la RLS, les fonctions `pg_cron` appelées directement, les services.
- **End-to-end (Playwright)** : parcours critiques seulement.
- Règle : toute règle financière a des tests unitaires **et** au moins un test d'intégration sur sa fonction SQL ; toute frontière de sécurité a un test d'intégration.

**Données et horloge**
- **Jeu de départ déterministe** (`supabase/seed`) pour les tests d'intégration et le staging : deux structures (une SCI avec deux biens, une personne physique avec un bien) ; dans la première, les trois rôles de membre ; dans la seconde, un administrateur ; deux colocataires rattachés au même bail ; un locataire rattaché dans la seconde structure ; un utilisateur membre de la première et locataire dans la seconde ; un profil désactivé.
- Fonction **`app_today()`** : date du jour à Paris, avec date imposée acceptée **uniquement** si le paramètre de base `app.environment` vaut `test` (impossible en staging et en production).

**Sécurité**
- Tests de RLS et de droits **générés depuis une matrice déclarative** (utilisateur × table × action → autorisé ou refusé) dérivée de la matrice des autorisations ; **test de garde** qui échoue si une table du schéma `public` n'a pas la RLS activée ou n'est pas dans la matrice ; tests du Storage (accès direct refusé) et des routes de téléchargement (lien expiré, autre structure, autre locataire).

**End-to-end** (Playwright, bureau et mobile 390 px pour les parcours locataire, contrôle d'accessibilité `axe` bloquant sur les violations critiques, moins de dix minutes en CI) :
1. création d'une structure par l'opérateur, invitation d'un administrateur, connexion avec TOTP ;
2. création d'un bien, d'un dossier locataire et d'un bail, apparition de l'échéance (horloge de test) ;
3. paiement partiel, impayé, paiement complémentaire, émission de la quittance, téléchargement du PDF ;
4. invitation d'un locataire, demande, validation, téléchargement de la quittance sur mobile ;
5. annulation d'un paiement ayant une quittance ;
6. accès direct par URL aux données d'une autre structure ou d'un autre locataire, refusé.

**PDF**
- Pas de comparaison d'images. Extraction du texte du PDF : mentions, identifiant, montants en chiffres et en lettres, colocataires présents sur la période, mention « signé électroniquement », distinction quittance et reçu partiel ; empreinte SHA-256 du fichier stocké égale à celle de `receipts` ; un téléchargement ne régénère pas le fichier. Rendu visuel validé **une fois** par revue humaine de la variante C avant la production, avec liste de contrôle dans `docs`.

**Seuils et critères**
- Un seul seuil bloquant : **100 % des branches** sur les fonctions financières pures ; couverture globale indicative.
- Critères d'acceptation transverses dans `docs/definition-of-done.md`, repris dans chaque ticket du backlog : tests pertinents verts ; règles financières côté serveur et en fonctions SQL pour les écritures multiples ; politique RLS et ligne de la matrice pour toute nouvelle table ou colonne sensible ; entrée `audit_logs` pour toute opération sensible ; migration compatible avec le schéma précédent ; messages et interface en français, contrôle d'accessibilité pour une nouvelle page ; aucun secret ni donnée personnelle dans code, journaux ou jeu de départ ; documentation à jour, avec un ADR si la décision est difficile à renverser, surprenante et issue d'un vrai compromis.

**Migrations**
- La CI applique toutes les migrations depuis une base vide, puis le chemin de mise à niveau (schéma de la version précédente et jeu de départ, puis nouvelles migrations). Un contrôle automatique refuse une migration contenant `DROP`, `RENAME` ou `TRUNCATE`, sauf annotation explicite `-- contract: <ticket>` signalant une étape « contract » préparée.

**Volumétrie (décision de l'utilisateur)**
- Hypothèse d'échelle : **trois baux en parallèle**. Pas de jeu de volumétrie dédié ni de job de nuit, pas de test de charge concurrente. Un test d'intégration ordinaire charge un historique de dix ans pour trois baux simultanés (environ 360 échéances) et vérifie que les vues du tableau de bord et les listes répondent en moins de 500 ms. À revoir si l'échelle augmente.

**Recette**
- Recette manuelle par l'utilisateur sur le staging, d'abord avec des données fictives puis avec la reprise d'historique réelle d'une structure, selon une liste de scénarios dans `docs/recette.md` (cycle complet d'un bail, paiement partiel, annulation, quittance sur mobile, accès refusé). La recette est signée (case cochée et date) avant toute utilisation réelle ; elle inclut les deux jalons ouverts : sauvegardes (risque accepté) et durée de conservation comptable.

**Reprise de l'historique** (exigence ajoutée par l'utilisateur, traitée au ticket dédié) : les cas à tester comprennent la saisie de baux et paiements aux dates passées sans impayé ni retard artificiel, le rejeu sans doublon, le marquage « reprise d'historique », et la cohérence de la numérotation des documents.

Cas imposes par le ticket clos sur lapurement des charges : montant signe et zero reserve a lapurement final ; un seul apurement final non annule par bail ; alerte Apurement final a saisir ; blocage de anonymize_tenant sans apurement final ; unallocated_refund plafonne au reste non affecte avec verrouillage concurrent ; aucun effet sur echeances, soldes et quittances ; solde estime avec complement recu.
