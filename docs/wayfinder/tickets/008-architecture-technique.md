---
title: Architecture technique, environnements et déploiement
type: grilling
status: closed
assignee: massonr
blocked_by:
  - 002-rgpd-et-hebergement.md
  - 004-matrice-autorisations.md
---

## Question

Quelle est l'architecture détaillée du monolithe Next.js ? À trancher avec l'utilisateur : découpage en modules et dossiers (services, accès base, autorisations, documents), frontière entre Server Actions et services, atomicité des écritures financières (fonctions SQL ou transactions), génération des échéances (déclenchement idempotent sans système de tâches complexe), génération des PDF côté serveur, environnements dev, preview et production avec Supabase et Vercel, gestion des secrets, sauvegardes et procédure de restauration, migrations non destructives en production.

Faits issus du ticket clos sur le RGPD : Supabase `eu-west-3` (Paris) et Vercel `regions: ["cdg1"]` à configurer explicitement (défaut `iad1`) ; sauvegardes de 7 à 30 jours sans Storage ; accord de sous-traitance (art. 28) à prévoir entre propriétaire et éditeur.

Décisions issues du ticket clos sur les autorisations : module serveur isolé pour `service_role` (trois usages) ; route serveur de téléchargement avec lien de 60 secondes et aucune politique Storage pour le navigateur ; droits relus en base à chaque requête ; création des structures par script ou page d'administration minimale de l'opérateur ; support par accès direct à la base, à documenter pour la production.

Décisions issues du ticket clos sur le rattachement : limitation de débit à 10 tentatives par heure par IP et par profil sur la consommation des liens ; message d'erreur unique pour les liens invalides ; expiration des demandes à 30 jours (traitement automatique idempotent, comme la création des échéances) ; seuls e-mails envoyés : authentification (fournisseur d'e-mail à choisir).

Décisions issues du ticket clos sur la mise en page PDF : le PDF est généré côté serveur selon la variante C (colonnes, frise, jauge) avec une image de signature lue depuis le bucket privé ; validation du type et de la taille de l'image à l'envoi.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Code**
- Un seul projet Next.js organisé **par domaine** (identité et structures, biens, locataires et baux, finances, dépenses, documents, tableau de bord) ; chaque domaine contient schémas Zod, service, accès base et contrôles d'autorisation. Dépendance : page ou composant → Server Action → service → accès base. Aucun composant ne touche la base ni ne porte de règle financière. Calculs financiers (prorata, solde, statut) en **fonctions pures** testées à part.
- **Server Actions** pour les mutations, **Route Handlers** pour les fichiers. Enchaînement fixe : authentification, validation Zod, service qui vérifie `has_permission`.
- Un dépôt : `src/`, `supabase/` (migrations, graines, configuration), `e2e/`, `docs/` (dont `docs/adr`, exploitation, carte wayfinder). pnpm, Node LTS fixé, tests de sécurité en Vitest avec un client par utilisateur de test (pas de pgTAP), interface en français sans bibliothèque d'i18n.

**Données et traitements**
- Chaque opération multi-lignes (paiement avec affectations, annulation, déplacement d'affectation, émission de quittance) est une **fonction SQL** versionnée en migration, exécutée en une transaction sous les droits de l'utilisateur (donc sous la RLS). Invariants aussi imposés par contraintes : affectation jamais supérieure au montant disponible ni au solde, unicité (bail, période).
- **`pg_cron`** quotidien : fonction SQL idempotente `create_due_rent_charges()` (date du jour à Paris) et fonction d'expiration des demandes et invitations. Le rattrapage à la saisie d'un bail appelle la même fonction pour ce bail. Conséquence : `service_role` n'est plus utilisé pour les échéances, il reste **deux usages** (invitations et rattachements, liens de téléchargement temporaires).
- **PDF** : Route Handler Node en région `cdg1`, bibliothèque PDF programmatique sans navigateur (choix précis à l'implémentation par un test de la variante C), génération **unique à l'émission**, stockage dans le bucket privé avec **empreinte SHA-256** dans `receipts` ; les téléchargements servent toujours le fichier stocké.
- **Authentification forte** : TOTP obligatoire pour l'administrateur et le gestionnaire (native Supabase), codes de secours, aucune double authentification pour les locataires, réinitialisation par l'opérateur via accès direct à la base.
- **Outil de l'opérateur** : script en ligne de commande (`pnpm operator:create-structure`) exécuté depuis son poste avec `service_role`, qui crée la structure et invite son premier administrateur, avec trace dans `audit_logs` ; aucune page d'administration dans le MVP.

**Environnements et exploitation**
- Local (Supabase CLI avec Docker), preview (un projet Supabase de staging partagé, données fictives uniquement), production (projet dédié en offre Pro). Pas de branches Supabase payantes. Secrets dans les variables d'environnement Vercel par environnement, jamais dans le dépôt ni en `NEXT_PUBLIC`, `.env.example` à jour ; aucune donnée de production hors production. Journaux : Vercel et `audit_logs` sans données personnelles ; pas de service externe d'erreurs dans le MVP.
- **Migrations** dans `supabase/migrations` : automatiques sur le staging à chaque fusion dans `main` ; sur la production, workflow manuel avec approbation, précédé d'une sauvegarde ; jamais de migration destructive en une étape (expand puis contract).
- **Déploiement** : la production se déploie depuis une branche `production`, que le workflow fait avancer sur `main` après la migration de production ; `main` déploie un staging stable ; le code reste compatible avec le schéma précédent d'une version.
- **CI** : à chaque pull request, vérification TypeScript, ESLint, tests unitaires Vitest, tests d'intégration sur Supabase local (dont RLS et isolation), build, tests Playwright sur la pile locale ; tous bloquants ; `main` protégée, pull request obligatoire même pour un développeur seul.
- **Sauvegardes (décision de l'utilisateur)** : aucun export personnalisé ni test de restauration pour le MVP ; production en offre Pro pour les sauvegardes natives quotidiennes de 7 jours de la base, **Storage non sauvegardé** (PDF et signatures). Risque accepté, à inscrire au registre des risques ; jalon à revoir avant la première utilisation avec des données réelles ; le point reste au Lot 6 du backlog avec ce statut. Cela écarte l'export chiffré hors Supabase proposé à l'origine.
