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
