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

Décisions issues du ticket clos sur les autorisations : table `role_permissions` et fonction `has_permission` ; champs sensibles (codes d'accès, garant, aide au logement, date de naissance) dans des tables séparées ; aucune politique de suppression sur les tables financières et documentaires ; chemin des fichiers `{structure}/{bail}/{document}.pdf` ; une structure garde au moins un administrateur actif ; les invitations couvrent membres et locataires.

Décisions issues du ticket clos sur le rattachement : `invitations` avec un type (membre ou locataire), un jeton haché, usage unique, validité de 14 jours, révocation, lien à une adresse e-mail (membre) ou à un dossier (locataire) ; `tenant_account_links` avec statut (en attente, validée, refusée, révoquée, expirée), consentement à la remise dématérialisée (profil, horodatage, version du texte), retrait du consentement, un seul rattachement actif par dossier ; indicateur « remise papier demandée » sur le dossier.

Décisions issues du ticket clos sur la mise en page PDF : variante C retenue ; une image de signature (PNG ou JPEG) téléversée par le propriétaire est incluse dans le document avec la mention « signé électroniquement » et l'identifiant du document. À trancher ici : rattachement de la signature (structure ou membre), qui peut la téléverser, limites du fichier, figement de l'image dans l'instantané de la quittance, comportement sans signature téléversée.
