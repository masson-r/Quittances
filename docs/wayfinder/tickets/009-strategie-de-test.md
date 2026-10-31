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
