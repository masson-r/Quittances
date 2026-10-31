---
title: Matrice des autorisations et stratégie RLS
type: grilling
status: open
assignee:
blocked_by: []
---

## Question

Qui peut faire quoi, et comment est-ce appliqué ? À trancher avec l'utilisateur :
- permissions précises des rôles administrateur, gestionnaire et lecteur par ressource (structure, bien, locataire, bail, échéance, paiement, dépense, quittance, membres) ;
- accès du locataire rattaché (quittances de ses baux, ses informations) ;
- règle de répartition entre contrôle serveur et RLS PostgreSQL, et usage strictement limité de la clé `service_role` ;
- gestion des comptes désactivés et des rattachements révoqués ;
- extensibilité du modèle de permissions sans refonte (README §4.3).
