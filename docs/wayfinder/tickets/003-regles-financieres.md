---
title: Règles financières des échéances, paiements et soldes
type: grilling
status: open
assignee:
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
