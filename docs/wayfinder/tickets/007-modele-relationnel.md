---
title: Modèle relationnel et contraintes de la base
type: grilling
status: closed
assignee: massonr
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

Décisions issues du ticket clos sur l'architecture : opérations multi-lignes en fonctions SQL sous RLS avec contraintes d'invariants ; fonctions `create_due_rent_charges()` et d'expiration pour `pg_cron` (date du jour à Paris) ; empreinte SHA-256 du PDF stockée dans `receipts` ; TOTP géré par Supabase Auth ; interface en français uniquement.

## Résolution

Décidé avec l'utilisateur, en grilling. Les noms de tables ci-dessous sont les identifiants anglais ; les termes français sont dans le glossaire.

**Conventions**
- Clés primaires `uuid` (`gen_random_uuid()`), `snake_case` anglais, `created_at` et `updated_at` en `timestamptz` UTC. Montants en `integer` de centimes avec `CHECK` de signe, sommes en `bigint`. Dates métier en `date` sans fuseau (heure de Paris). `archived_at` pour les entités (structures, biens, dossiers). Lignes financières et documentaires jamais supprimées : `cancelled_at`, `cancelled_by`, `cancellation_reason`.
- Chaque table de gestion porte `entity_id` ; **clés étrangères composites** `(entity_id, x_id)` vers `x(entity_id, id)` pour interdire en base tout lien entre structures ; la RLS se contrôle directement sur `entity_id`.

**Identité et autorisations**
- `profiles` : `id` = `auth.users.id`, prénom, nom, `email` copié par trigger depuis l'authentification, statut actif ou désactivé.
- `ownership_entities` : nom, genre (personne physique, SCI, autre), coordonnées, informations administratives facultatives (par exemple SIRET), `archived_at`.
- `entity_memberships` : (structure, profil) unique, rôle (administrateur, gestionnaire, lecteur), statut (actif, suspendu) ; trigger de contrainte garantissant au moins un administrateur actif.
- `role_permissions` : (rôle, permission) remplie par migration ; `has_permission(structure, permission)`.
- `invitations` et `tenant_account_links` comme décidés au ticket sur le rattachement (type, jeton haché, usage unique, 14 jours, révocation ; statuts, consentement horodaté avec version du texte, un seul rattachement actif par dossier).

**Patrimoine et location**
- `properties` : structure, libellé, adresse en champs séparés (ligne 1, ligne 2, code postal, ville), description, `archived_at`. `property_maintenance_notes` en **ajout seul** (bien, date, auteur, texte ; correction par nouvelle note), lisibles par le lecteur. Un bien ayant des baux ou dépenses ne se supprime jamais.
- `tenants` : nom, prénom, e-mail, coordonnées, statut, indicateur « remise papier demandée ».
- `tenant_private_details` (une ligne par dossier) : `birth_date` facultative, type de garant (aucun, personne physique, Visale, caution bancaire, autre), nom et coordonnées du garant, type d'aide au logement (aucune, versée au locataire, versée au bailleur), note ; aucun justificatif de garant stocké. `property_access_codes` : bien, libellé, code, note. Ces deux tables sont lisibles par l'administrateur et le gestionnaire seulement ; pas de chiffrement applicatif au MVP (chiffrement au repos du fournisseur plus RLS).
- `leases` : bien, dates de début et de fin, jour d'échéance, règle de prorata, champs informatifs sur le dépôt de garantie (montant, date de réception).
- `lease_tenants` : (bail, dossier) avec **période de présence** (`start_date`, `end_date`) : un colocataire entre ou sort sans nouveau bail ; la quittance nomme ceux présents sur sa période.
- `rental_terms` : (bail, `effective_from`) unique, loyer, charges, motif, **sans colonne de fin** (la fin est la date d'effet de la version suivante) ; première version à la date de début du bail.

**Finances**
- `rent_charges` : bail, période (début, fin), `due_on`, `rent_cents`, `charges_cents`, `total_cents` (colonne générée), version de conditions utilisée, `cancelled_*` ; unicité (bail, période) limitée aux échéances non annulées. **Ni montant payé, ni solde, ni statut stockés** : la vue `rent_charge_balances` (`security_invoker`) les calcule à partir des affectations actives et de la date du jour à Paris.
- `payments` : structure, **bail obligatoire**, montant strictement positif, date de réception, mode (virement, chèque, espèces, autre), référence et commentaire facultatifs, auteur, `cancelled_*`. `payment_allocations` : paiement, échéance du même bail (clé composite), montant strictement positif ; jamais supprimée : annulation par `reversed_at`, `reversed_by`, `reversal_reason` ; seules les affectations non annulées comptent. Un locataire qui paie deux baux fait deux paiements.
- **Invariants en deux couches** : verrouillage (`SELECT … FOR UPDATE`) dans les fonctions SQL d'opération, puis triggers de contrainte en dernier recours : somme des affectations actives d'un paiement ≤ son montant, somme sur une échéance ≤ son total, affectation vers une échéance non annulée.
- `expenses` : structure, bien, date, catégorie, description, montant strictement positif, indicateur « potentiellement récupérable », justificatif facultatif, auteur, `cancelled_*` (actif ou annulé, pas de suivi de paiement). `expense_categories` par structure, remplie à la création avec les sept catégories initiales, modifiable par l'administrateur (renommer, ajouter, archiver). `documents` : métadonnées des **justificatifs de dépenses uniquement** (structure, chemin, type, taille, empreinte, auteur).

**Documents**
- `receipts` unique pour les deux genres (`kind` : `quittance` ou `partial_receipt`) : bail, échéance, paiement pour un reçu, **identifiant lisible** par structure, genre et année (par exemple `QUI-2026-09-0042`), `issued_on` et `paid_on` éditables avec enregistrement des valeurs proposées, **instantané `jsonb`** de tout ce que le PDF affiche (bailleur, locataires présents, logement, montants, règlements, référence de signature), chemin du fichier, SHA-256, numéro de version, `supersedes_receipt_id`, `cancelled_*`. Une seule quittance non annulée par échéance.
- `entity_signatures` : structure, chemin, type, taille, empreinte, auteur, date, `active` ; **une seule active par structure**, anciennes conservées ; téléversement par l'administrateur seul (permission `signature:manage`) ; PNG ou JPEG, 500 Ko et 1 200 × 600 pixels au maximum, EXIF supprimé ; référencée dans l'instantané (identifiant et empreinte) et incorporée au PDF ; **facultative** : sans elle, le document porte la mention « signé électroniquement » et l'identifiant du document, sans image.

**Immutabilité**
- Triggers `BEFORE DELETE` qui refusent toute suppression sur `rent_charges`, `payments`, `payment_allocations`, `receipts`, `documents` et `audit_logs`, y compris pour `service_role`. Triggers `BEFORE UPDATE` limitant les colonnes modifiables : sur un paiement, référence, commentaire, mode, date de réception et `cancelled_*` ; sur une quittance émise, champs d'annulation et de remplacement seulement.

**Journal d'audit**
- `audit_logs` en **ajout seul**, écrit par les fonctions SQL et des triggers, jamais par le code applicatif : date, structure, auteur (profil, « système » pour `pg_cron`, « opérateur » pour le script), action (par exemple `payment.cancelled`), table et identifiant de l'objet, détails `jsonb` limités à des identifiants et valeurs non personnelles (montants, dates, motifs), jamais de nom ni d'e-mail.
- Opérations journalisées : paiements (saisie, modification, annulation), affectations (création, déplacement, annulation), échéances (recalcul, annulation), quittances et reçus (émission avec dates proposées et retenues, annulation, remplacement), baux et conditions (création, modification), membres et invitations (création, révocation, changement de rôle, suspension), rattachements (demande, validation, refus, révocation, retrait du consentement), signature (téléversement, remplacement), avertissement espèces confirmé, actions de l'opérateur. Les connexions restent dans les journaux de Supabase Auth.
- Conservation **3 ans** (prescription), puis suppression par une fonction de purge dédiée, seule exception au trigger d'ajout seul.

**Fin de vie d'un dossier (RGPD)**
- Pas de purge automatique au MVP. Fonction `anonymize_tenant(dossier)` exécutée **manuellement** par l'administrateur, utilisable 3 ans après la fin du dernier bail : remplace nom, prénom, e-mail et coordonnées, supprime `tenant_private_details` et le rattachement, conserve lignes financières et quittances (dont l'instantané nomme encore la personne). La **durée de conservation comptable côté bailleur reste à confirmer avant l'utilisation réelle** (point ouvert de la recherche RGPD).

Mise a jour issue du ticket clos sur lapurement des charges : table charge_settlements (montant signe, genres charges_adjustment et unallocated_refund, is_final avec unicite partielle par bail) ; documents sert aussi aux justificatifs dapurement ; anonymize_tenant refuse un dossier dont un bail termine na pas dapurement final ; audit_logs couvre charge_settlement.created, .modified et .cancelled.

Mise a jour issue du ticket clos sur la reprise dhistorique : tables import_batches (structure, date, operateur, empreinte, decomptes, statut) ; colonnes external_ref (unique par structure et par table) et import_batch_id sur les lignes importees ; fonctions cancel_import_batch et history_import ; echeance pouvant porter des montants imposes par le lot ; identifiant de document numerote par structure, genre et annee de la date demission.
