---
title: Reprise de l'historique de location déjà réalisé
type: grilling
status: open
assignee:
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
