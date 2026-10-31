---
title: Modèle relationnel et contraintes de la base
type: grilling
status: open
assignee:
blocked_by:
  - 001-cadre-legal-quittances.md
  - 002-rgpd-et-hebergement.md
  - 003-regles-financieres.md
  - 004-matrice-autorisations.md
  - 005-parcours-rattachement-locataire.md
---

## Question

Quel est le diagramme relationnel final ? À trancher avec l'utilisateur : tables du README §7 et ajouts nécessaires, clés étrangères et règles de suppression, contraintes d'unicité (une échéance par bail et période), types des montants (centimes entiers) et des dates (sémantique métier, UTC technique), ce qui est stocké et ce qui est calculé (soldes et statuts), instantané des quittances, champs soumis à minimisation RGPD, et ce que chaque politique RLS doit pouvoir exprimer.

Faits issus du ticket clos sur le RGPD : date de naissance facultative et absente des quittances ; garants limités au décret 2015-1437 ; `audit_logs` par identifiants sans données personnelles recopiées ; archive restreinte de 3 ans après clôture, puis purge ou anonymisation.

Décisions issues du ticket clos sur les règles financières : statut « annulée » sur les échéances avec unicité (bail, période) limitée aux non annulées (index partiel) ; annulations de paiements et de quittances conservées avec motif ; montants en centimes entiers ; aucune échéance créée avant sa date d'échéance.
