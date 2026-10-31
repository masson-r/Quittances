---
title: Matrice des autorisations et stratégie RLS
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Qui peut faire quoi, et comment est-ce appliqué ? À trancher avec l'utilisateur :
- permissions précises des rôles administrateur, gestionnaire et lecteur par ressource (structure, bien, locataire, bail, échéance, paiement, dépense, quittance, membres) ;
- accès du locataire rattaché (quittances de ses baux, ses informations) ;
- règle de répartition entre contrôle serveur et RLS PostgreSQL, et usage strictement limité de la clé `service_role` ;
- gestion des comptes désactivés et des rattachements révoqués ;
- extensibilité du modèle de permissions sans refonte (README §4.3).

## Résolution

Décidé avec l'utilisateur, en grilling.

**Rôles de membre** (L = lecture, E = écriture, A = annulation ou archivage)
- **Administrateur** : L E A sur tout, y compris structure (informations, archivage), membres et invitations de membres ; seul rôle à lire le journal d'audit.
- **Gestionnaire** : L E A sur biens, dossiers locataires, baux et conditions de loyer, échéances (recalcul, annulation), paiements et affectations (correction, annulation), dépenses, quittances et reçus (émission, annulation) ; L sur la structure ; aucun accès aux membres ni au journal d'audit.
- **Lecteur** : L sur tout sauf membres, journal d'audit et champs sensibles.
- Aucun rôle ne supprime physiquement une donnée financière ou documentaire.

**Application des règles**
- **RLS** sur toutes les tables : appartenance à la structure (ou rattachement validé pour un locataire) et rôle minimum pour écrire ; aucune politique de suppression sur les tables financières et documentaires.
- **Services serveur** : règles métier fines ; jamais de contournement de la RLS pour les lectures utilisateur.
- **Champs sensibles** (codes d'accès, garant, aide au logement, date de naissance) dans des **tables séparées**, lisibles par l'administrateur et le gestionnaire seulement (la RLS filtre les lignes, pas les colonnes).
- **Extensibilité** : table `role_permissions` (rôle, permission) remplie par migration, permissions nommées (`payment:write`), fonction SQL unique `has_permission(structure, permission)` partagée par la RLS et les services ; trois rôles fixes, pas de rôles personnalisés dans le MVP.
- **Clé `service_role`** : module serveur isolé avec vérification d'autorisation préalable, pour trois usages seulement : création automatique des échéances, consommation des invitations et création des rattachements, liens de téléchargement temporaires. Jamais pour les opérations des utilisateurs sur les données de gestion.

**Accès du locataire rattaché**
- Voit : quittances et reçus partiels émis des baux de son dossier (colocataires du même bail inclus, filtre par période, téléchargement), son dossier en lecture sans garant ni aide au logement avec modification tracée de ses coordonnées, un résumé de ses baux (adresse, dates, loyer et charges).
- Ne voit pas : échéances, paiements, soldes, dépenses, quittances annulées.
- L'accès aux quittances persiste après la fin du bail jusqu'à révocation (la révocation relève du ticket sur le parcours d'inscription).

**Comptes, contextes, fichiers, opérateur**
- Droits **relus en base à chaque requête**, jamais portés par le jeton de session ; profil désactivé refusé immédiatement avec révocation des sessions ; appartenance suspendue ou rattachement révoqué : effet immédiat ; liens de téléchargement de 60 secondes.
- **Aucun cumul de droits entre contextes** : espace propriétaire limité aux structures dont l'utilisateur est membre (sélecteur de structure, vue consolidée au tableau de bord), espace locataire limité aux rattachements ; être locataire dans une structure où l'on est membre n'ajoute aucun droit.
- **Fichiers privés** : bucket privé unique, chemins `{structure}/{bail}/{document}.pdf`, aucune politique Storage pour le navigateur ; téléchargement uniquement par route serveur après contrôle (RLS sur les métadonnées), puis lien de 60 secondes ; justificatifs de dépenses réservés aux membres de la structure.
- **Création de structures** : pas de création publique ; l'opérateur crée les structures et désigne le premier administrateur (script ou page d'administration minimale). Membres ajoutés par invitation par e-mail à usage unique, avec rôle prédéfini, durée de validité et révocation, sur le même mécanisme que l'invitation des locataires. Une structure garde toujours au moins un administrateur actif.
- **Opérateur** : aucun accès par l'interface aux structures dont il n'est pas membre, ni rôle global, ni usurpation d'identité ; support par accès direct à la base, hors application et documenté.
