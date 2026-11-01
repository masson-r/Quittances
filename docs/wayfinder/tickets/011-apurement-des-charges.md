---
title: Apurement des charges : saisie manuelle du remboursement
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Comment s'enregistre l'apurement des charges (README §5.12), c'est-à-dire le remboursement manuel au locataire d'un trop-perçu de charges, en cours ou en fin de bail ? À trancher avec l'utilisateur :
- ce qui est saisi (bail, montant, date, motif) et la table correspondante ;
- effet sur les échéances, les soldes et les quittances déjà émises (aucun, ou un document dédié) ;
- traitement dans le tableau de bord (sortie de trésorerie distincte des dépenses ?) ;
- sort d'un paiement resté non affecté qu'il faut rembourser au locataire, et fin de bail ;
- annulation, droits par rôle et journal d'audit.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Table `charge_settlements`** (structure, bail)
- Champs : date, `amount_cents` **entier signé**, mode (virement, chèque, espèces, autre), motif, **période de charges régularisée** facultative (début et fin), auteur, justificatif facultatif via `documents` (dont l'usage s'élargit aux justificatifs d'apurement), `cancelled_*`.
- Deux genres : `charges_adjustment` (signé) et `unallocated_refund` (toujours positif, exige un paiement et un montant inférieur ou égal à son reste non affecté, réduit d'autant « À affecter ») ; pour un paiement saisi par erreur, la bonne voie reste l'annulation du paiement.
- **Montant positif** = remboursement versé au locataire (sortie) ; **montant négatif** = complément de charges effectivement **reçu** du locataire (entrée), enregistré à la réception ; pas de suivi de créance de complément non encore payé au MVP. Le montant **zéro** n'est autorisé que sur l'apurement final.
- Compensation sur un loyer : deux écritures (paiement complet du loyer et remboursement) ; les flux bruts sont gonflés, le net reste exact.

**Apurement final obligatoire**
- Indicateur `is_final` : **au plus un apurement final non annulé par bail** (index partiel d'unicité), éventuellement nul. Plusieurs apurements sont possibles pendant le bail.
- Un bail dont la date de fin est dépassée sans apurement final affiche « **Apurement final à saisir** » sur sa fiche et dans un compteur du tableau de bord.
- Cette absence **bloque** `anonymize_tenant` pour le dossier concerné, mais **ne bloque ni** la saisie des paiements **ni** l'émission des quittances. Saisissable avant ou après la date de fin ; annulable puis ressaisissable.

**Effets**
- **Aucun effet** sur les échéances, les soldes et les quittances déjà émises (les charges restent des provisions). Pas de PDF dédié au MVP : l'entrée est visible dans la fiche du bail avec son justificatif.
- **Tableau de bord** : sortie ou entrée de trésorerie distincte des dépenses, hors catégories de dépense. Indicateur **« Remboursements de charges (net) »** = somme signée à la date de la ligne ; solde de trésorerie estimé = encaissé − dépenses − remboursements nets (un complément reçu l'augmente) ; les compléments ne comptent pas dans « encaissé ». Indicateur dans le bandeau et colonne dans la comparaison par bien.
- **Validations** : saisie à tout moment, pendant le bail ou après sa fin, y compris sur un bail archivé ; montant non nul sauf apurement final ; date non future ; bail de la même structure ; plafond du paiement non affecté pour `unallocated_refund` ; montant non comparé aux charges payées (non calculé).

**Annulation, droits, audit**
- Mêmes principes que les paiements : aucune suppression ; annulation avec motif ; colonnes modifiables limitées à la référence, au commentaire, au mode, à la date et au justificatif, avec trace avant/après ; montant corrigé seulement par annulation puis nouvelle saisie ; invariants par verrouillage dans la fonction SQL `record_charge_settlement` et trigger de contrainte.
- Administrateur et gestionnaire : lecture, saisie, annulation ; lecteur : lecture. `audit_logs` : `charge_settlement.created`, `.modified`, `.cancelled`.
