---
title: Architecture technique, environnements et déploiement
type: grilling
status: open
assignee:
blocked_by:
  - 002-rgpd-et-hebergement.md
  - 004-matrice-autorisations.md
---

## Question

Quelle est l'architecture détaillée du monolithe Next.js ? À trancher avec l'utilisateur : découpage en modules et dossiers (services, accès base, autorisations, documents), frontière entre Server Actions et services, atomicité des écritures financières (fonctions SQL ou transactions), génération des échéances (déclenchement idempotent sans système de tâches complexe), génération des PDF côté serveur, environnements dev, preview et production avec Supabase et Vercel, gestion des secrets, sauvegardes et procédure de restauration, migrations non destructives en production.

Faits issus du ticket clos sur le RGPD : Supabase `eu-west-3` (Paris) et Vercel `regions: ["cdg1"]` à configurer explicitement (défaut `iad1`) ; sauvegardes de 7 à 30 jours sans Storage ; accord de sous-traitance (art. 28) à prévoir entre propriétaire et éditeur.

Décisions issues du ticket clos sur les autorisations : module serveur isolé pour `service_role` (trois usages) ; route serveur de téléchargement avec lien de 60 secondes et aucune politique Storage pour le navigateur ; droits relus en base à chaque requête ; création des structures par script ou page d'administration minimale de l'opérateur ; support par accès direct à la base, à documenter pour la production.

Décisions issues du ticket clos sur le rattachement : limitation de débit à 10 tentatives par heure par IP et par profil sur la consommation des liens ; message d'erreur unique pour les liens invalides ; expiration des demandes à 30 jours (traitement automatique idempotent, comme la création des échéances) ; seuls e-mails envoyés : authentification (fournisseur d'e-mail à choisir).
