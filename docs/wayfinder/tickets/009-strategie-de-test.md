---
title: Stratégie de test et critères d'acceptation transverses
type: grilling
status: open
assignee:
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
