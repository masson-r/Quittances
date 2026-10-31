---
title: Règles financières des échéances, paiements et soldes
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Quelles sont les règles financières exactes du système ? À trancher avec l'utilisateur :
- génération idempotente des échéances (fenêtre, jour d'échéance, fin de bail) ;
- prorata d'entrée et de sortie en jours réels, et arrondis (centimes entiers) ;
- changement de conditions de loyer en cours de période ;
- affectation des paiements : manuelle ou proposée, ordre par défaut, trop-perçus et paiements en avance ;
- calcul du solde et des statuts (à venir, à payer, partiellement payée, payée, en retard) et jour de bascule en retard ;
- annulation par écriture inverse d'un paiement et conséquences sur les affectations ;
- conditions d'émission d'une quittance (échéance intégralement réglée) et date de paiement affichée en cas de paiements multiples.
- plafond légal des paiements en espèces (1 000 € pour un débiteur domicilié en France, voir le ticket clos sur le cadre légal) : simple avertissement ou blocage à la saisie.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Échéances**
- Une période est un mois civil ; le loyer est payable d'avance ; la date d'échéance est le jour d'échéance du bail dans le mois, **bornée à la période d'occupation** (première échéance à la date de début, dernière à la date de fin) et ramenée au dernier jour du mois pour les jours 29 à 31.
- **Aucune génération à l'avance** : l'échéance est créée automatiquement quand sa date d'échéance est atteinte, de façon idempotente. Unicité sur (bail, période), limitée aux échéances non annulées.
- Un bail saisi avec une date de début passée déclenche le **rattrapage** immédiat de toutes les échéances dont la date est atteinte, sans doublon.
- Le statut « À venir » disparaît (aucune échéance n'existe avant sa date).

**Montants**
- Montants en centimes entiers. Prorata en jours réels du mois : `montant mensuel × jours occupés ÷ jours du mois`, arrondi au centime le plus proche, loyer et charges arrondis séparément, total = loyer + charges.
- Une nouvelle version de conditions de loyer s'applique à la première période commençant à la date d'effet ou après, sans découpage d'une période. Aucune échéance existante n'est modifiée automatiquement.

**Paiements et affectations**
- Le système propose une affectation de la plus ancienne à la plus récente échéance impayée ; le propriétaire valide ou modifie. Le reste demeure non affecté ; les paiements en avance restent non affectés jusqu'à la création de l'échéance. Aucune affectation au-delà du solde de l'échéance.
- Correction en place avec trace avant/après : référence, commentaire, mode et date de réception. Montant et affectations : annulation puis nouvelle saisie.
- Retrait ou déplacement d'une affectation sans annuler le paiement, tracé ; refusé tant qu'une quittance émise dépend de l'échéance.
- Annulation d'un paiement : motif conservé, affectations neutralisées, soldes restaurés ; refusée tant que la quittance dépendante n'est pas annulée (les deux annulations sont proposées dans une confirmation unique et tracées séparément).
- Espèces à partir de 1 000 € : avertissement non bloquant, confirmation tracée.

**Statuts (calculés, jamais stockés)**
- À payer : date d'échéance non dépassée, aucun paiement affecté. Partiellement payée : paiement affecté, solde positif, date non dépassée. Payée : solde nul. En retard : solde positif et date dépassée, à partir du lendemain, prioritaire sur « partiellement payée ». Pas de calendrier de jours ouvrés.

**Corrections d'échéance**
- Une échéance sans affectation active peut être **recalculée** en place ou **annulée** (statut « annulée », conservée, exclue des soldes et indicateurs), toujours avec trace dans `audit_logs`.

**Quittance**
- Émise uniquement pour une échéance au solde nul, sur action explicite, jamais automatique.
- Date d'émission (par défaut aujourd'hui) et date de paiement (par défaut, réception du dernier paiement soldant l'échéance) modifiables à l'émission pour cette seule quittance ; ni date future, ni date de paiement postérieure à l'émission ; écarts tracés. Le détail des règlements multiples figure dans le document.
