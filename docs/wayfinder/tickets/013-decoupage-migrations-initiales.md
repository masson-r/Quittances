---
title: Découpage et ordre des migrations initiales
type: grilling
status: open
assignee:
blocked_by: []
---

## Question

Comment découpe-t-on les migrations SQL initiales (livrable « migrations initiales proposées » du README §17) à partir du modèle relationnel et des décisions clos ? À trancher avec l'utilisateur : nombre et ordre des fichiers (extensions et schémas, identité et autorisations, patrimoine et location, finances, documents, apurements et reprise d'historique, audit, RLS, fonctions SQL d'opération, vues du tableau de bord, `pg_cron`, graines), règle de nommage, ce qui appartient au Lot 1 et ce qui peut attendre un lot ultérieur (par exemple tables et fonctions du Lot 3 et du Lot 5), compatibilité avec la règle « expand puis contract » dès la première version, et jeu de départ pour les tests.
