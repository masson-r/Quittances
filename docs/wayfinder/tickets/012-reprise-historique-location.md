---
title: Reprise de l'historique de location déjà réalisé
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Comment saisit-on, avant ou pendant la mise en service, l'historique de location qui s'est déroulé hors de l'application (baux en cours ou terminés, paiements passés, quittances déjà remises) ? À trancher avec l'utilisateur, à partir des règles financières et du modèle relationnel clos :
- périmètre à reprendre : baux en cours et terminés, conditions de loyer successives, colocataires présents sur chaque période, paiements, quittances déjà remises sur papier ou par un autre outil ;
- mode de saisie : interface (saisie en lot) ou import par un script de l'opérateur à partir d'un fichier ; validation et rejeu sans doublon ;
- échéances passées : rattrapage déjà prévu à la saisie d'un bail, mais faut-il aussi permettre un solde d'ouverture sans détail des mois antérieurs ;
- paiements passés et leur affectation automatique aux échéances anciennes, sans les signaler comme impayés ou en retard ;
- quittances historiques : les régénérer avec les dates passées (date d'émission, date de paiement), ou les enregistrer comme « antérieures à l'application, non régénérées » avec le fichier d'origine en pièce jointe ;
- numérotation des identifiants de document face à une numérotation antérieure existante ;
- marquage de ces lignes comme « reprise d'historique » dans les données et dans `audit_logs`, et date de bascule par structure après laquelle la saisie normale s'applique ;
- effet sur le tableau de bord, les avertissements (espèces) et les tests de volumétrie.

Contexte donne par la cloture du ticket sur la strategie de test : echelle prevue de trois baux en parallele ; la reprise doit pouvoir sappuyer sur une saisie simple.

Contrainte issue du ticket clos sur le tableau de bord : les vues sur 1, 2, 3 et 5 ans exigent que lhistorique repris couvre au moins cinq ans de baux, de paiements et de depenses, et que ces lignes comptent normalement dans tous les indicateurs.

Contrainte issue du ticket clos sur lapurement des charges : les baux termines repris doivent aussi recevoir leur apurement final (eventuellement nul), sans quoi lalerte Apurement final a saisir sapplique et lanonymisation reste bloquee ; les lignes dapurement historiques sont des lignes de reprise comme les autres.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Périmètre**
- Reprise **en détail** (échéance par échéance, paiement par paiement) des **cinq dernières années au moins** avant la mise en service : baux en cours et terminés, versions de conditions de loyer, colocataires avec périodes de présence, paiements, dépenses, apurements de charges dont l'**apurement final** des baux terminés. Au-delà de cinq ans : facultatif, et en détail s'il est fait. **Pas de solde d'ouverture** sans détail.

**Mode de saisie : script de l'opérateur**
- Fichiers **CSV** avec modèles fournis : biens, dossiers locataires, baux (avec conditions et colocataires), paiements (affectation facultative), dépenses, apurements, et un fichier **facultatif d'échéances** imposant loyer, charges et date d'échéance réellement appliqués ; sans ligne imposée, le montant est calculé normalement, et le rapport liste les écarts entre imposé et calculé.
- Mode **`--dry-run`** : valide tout et imprime un rapport sans rien écrire.
- **Tout ou rien** : un lot s'exécute en une seule transaction ; si une ligne est invalide (montant interdit, bail introuvable, date future, catégorie de dépense inconnue, chevauchement de baux sur un même bien), **rien n'est écrit** et le rapport liste chaque erreur avec fichier et numéro de ligne. En cas d'échec de l'import, **tout est rejeté**.
- Lignes reliées par `external_ref`, unique par structure et par table. Rejeu d'un fichier identique : sans effet. Même `external_ref` avec un contenu différent : **conflit refusé** ; pour corriger, annuler la ligne ou le lot puis réimporter. Catégories de dépense reconnues par libellé, qui doit exister.
- Mêmes **fonctions SQL** que l'interface, donc mêmes invariants. L'interface permet toujours la saisie manuelle de lignes datées dans le passé. Les fichiers contiennent des données personnelles : ils restent sur le poste de l'opérateur, jamais dans le dépôt ni la CI, et les journaux n'impriment que des décomptes.

**Échéances, affectation, impayés**
- L'import crée le bail, ses conditions et ses colocataires, ce qui déclenche le **rattrapage**. Chaque paiement importé peut porter la période visée ; sinon affectation proposée de la plus ancienne à la plus récente et appliquée par l'import. Les statuts restent **calculés** : une échéance ancienne au solde positif apparaît réellement en retard ; **pas d'abandon de créance** au MVP. Le rapport `--dry-run` **liste les échéances restées impayées**.

**Quittances et numérotation**
- **Aucune régénération automatique**, aucun stockage des anciens fichiers. À la demande, émission normale d'une quittance sur une échéance ancienne soldée, avec dates d'émission et de paiement modifiables (dates passées acceptées, futures refusées) ; le document reflète les informations connues aujourd'hui.
- Identifiant par séquence **par structure, par genre et par année de la date d'émission retenue**, dans l'ordre d'émission réel ; aucune numérotation d'un ancien outil reprise.
- Une quittance nomme les colocataires dont la **période de présence chevauche au moins un jour** la période de l'échéance.

**Traçabilité**
- Table `import_batches` (structure, date, opérateur, empreinte SHA-256 des fichiers, décomptes, statut) ; lignes importées portant `import_batch_id`. **Une seule entrée d'audit par lot** (`history_import.completed`, avec décomptes et empreinte), pas une par ligne. **Pas d'avertissement espèces** pour les paiements importés. **Annulation en bloc** d'un lot (`cancel_import_batch`) selon le principe habituel : lignes marquées annulées avec motif, rien de supprimé. **Pas de date de bascule** : l'import n'écrit jamais de ligne datée dans le futur ; les échéances futures restent créées par `pg_cron`. Les lignes de reprise comptent comme les autres dans tous les indicateurs.
- **Contrôle** : le rapport (`--dry-run` et import réel) imprime par bail et par année les totaux appelé, encaissé, dépenses, remboursements nets et restant dû, et le nombre de lignes par table, pour comparaison manuelle avec les documents de l'utilisateur ; pas de fichier de totaux attendus.
