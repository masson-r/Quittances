---
status: proposed
---

# Soldes et statuts calculés, jamais stockés

L'échéance stocke uniquement ce qui est appelé (loyer, charges, total). Le montant payé, le solde et le statut sont toujours calculés par la vue `rent_charge_balances` à partir des affectations non annulées et de la date du jour à Paris. Un total stocké pourrait diverger des paiements après une annulation ou une correction concurrente, et le volume prévu (trois baux en parallèle) rend le calcul à la demande sans risque de performance.

Conséquence : toute lecture d'un solde passe par la vue ou par les fonctions du tableau de bord ; aucun champ « solde » ou « statut » ne doit être ajouté aux tables financières.
