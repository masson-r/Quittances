---
title: Indicateurs et vues du tableau de bord
type: grilling
status: closed
assignee: massonr
blocked_by: []
---

## Question

Comment se définissent exactement les indicateurs du tableau de bord et les vues SQL qui les produisent ? À trancher avec l'utilisateur, à partir des règles financières et du modèle relationnel clos :
- définitions de « loyers appelés » (échéances non annulées dont la date d'échéance tombe dans la période), « encaissé » (par date de réception du paiement ou par période d'échéance couverte par les affectations ?), « restant dû », « impayés échus », dépenses, « solde estimé » (à ne jamais présenter comme un résultat fiscal) ;
- traitement des paiements non affectés et des paiements reçus en avance dans les indicateurs ;
- évolution mensuelle des recettes et dépenses, comparaison des biens, nombre de biens actifs, baux en cours et locataires actifs ;
- filtres : structure, bien, mois, trimestre, année, période personnalisée ; vue consolidée de toutes les structures du membre ;
- liste des dernières opérations ;
- droits d'accès par rôle (le lecteur voit-il tout ?) et absence de totaux redondants stockés.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Indicateurs sur une période**
- **Loyers appelés** : somme des `total_cents` des échéances non annulées dont la date d'échéance tombe dans la période.
- **Encaissé** : somme des paiements non annulés dont la date de réception tombe dans la période (base trésorerie), affectés ou non, en avance ou non. Indicateur séparé **« À affecter »** : reste non affecté des paiements à ce jour.
- **Dépenses** : somme des dépenses non annulées dont la date tombe dans la période.
- **Solde de trésorerie estimé** = encaissé − dépenses, avec la mention « n'est pas un résultat fiscal ». Les remboursements d'apurement de charges y seront soustraits si le ticket sur l'apurement le décide.
- Ces quatre indicateurs (appelé, encaissé, dépenses, solde estimé) sont disponibles **pour l'ensemble des appartements ou pour un appartement**, sur des périodes **de 1, 2, 3 et 5 ans** (glissantes, se terminant aujourd'hui) en plus du mois, du trimestre, de l'année et des dates personnalisées.

**Indicateurs « à ce jour »** (date du jour à Paris)
- **Restant dû** : somme des soldes courants des échéances non annulées dont la date d'échéance est dans la période ou avant sa fin (bornée à aujourd'hui) ; solde du jour, pas une reconstitution du passé.
- **Impayés échus** : somme des soldes des échéances en retard, avec le nombre et le plus grand nombre de jours de retard, sur tout l'historique de la sélection. Il ouvre la page **Impayés** : échéances en retard triées par ancienneté, paiements reçus, historique des régularisations, avec **un lien vers le bail de chaque échéance**.

**Contenu**
- **Bandeau** : biens actifs, baux en cours (début passé, fin absente ou future), locataires actifs (dossiers présents sur un bail en cours à la date du jour), loyers appelés, encaissé, restant dû, impayés échus, dépenses, solde de trésorerie estimé, à affecter.
- **Évolution mensuelle** : barres « encaissé » et « dépenses » par mois et ligne « appelé », sur la période choisie (douze mois par défaut).
- **Comparaison par bien** : tableau (pas de graphique) avec appelé, encaissé, impayé, dépenses, solde et taux d'encaissement (encaissé ÷ appelé).
- **Dernières opérations** : les dix dernières saisies de paiements, dépenses et quittances émises, tirées de leurs tables métier et non du journal d'audit.

**Filtres**
- Structure (une, ou « toutes mes structures »), bien (un, plusieurs ou tous), période (mois, trimestre, année, 1, 2, 3 ou 5 ans, dates personnalisées). Par défaut : toutes mes structures, tous les biens, mois en cours. Filtres dans l'URL. Pas de comparaison avec la période précédente au MVP.

**Implémentation**
- Calcul **à la demande**, sans vue matérialisée ni total stocké, par trois fonctions SQL paramétrées exécutées sous les droits de l'utilisateur (donc sous la RLS) : `dashboard_summary(structures, biens, début, fin)`, `dashboard_monthly(…)`, `dashboard_by_property(…)`. Tous les rôles de membre, lecteur compris, lisent le tableau de bord complet ; les locataires n'en ont pas. Un test d'intégration recalcule chaque indicateur à partir des tables brutes du jeu de départ et exige l'égalité avec les fonctions.
- **Vue consolidée** : « toutes mes structures » additionne les indicateurs en euros ; le tableau de comparaison ajoute une colonne structure ; aucune règle de cumul de droits (la RLS filtre selon l'appartenance).

**Conséquence pour la reprise d'historique** : les vues sur 5 ans exigent que l'historique repris couvre **au moins cinq ans de baux, de paiements et de dépenses**, et que ces lignes comptent normalement dans tous les indicateurs. Ceci est reporté dans le ticket sur la reprise de l'historique.

Mise a jour issue du ticket clos sur lapurement des charges : lindicateur Remboursements de charges (net) est la somme signee des lignes de charge_settlements a leur date ; solde estime = encaisse - depenses - remboursements nets ; les complements recus ne comptent pas dans encaisse ; compteur Apurement final a saisir au tableau de bord ; colonne Remboursements dans la comparaison par bien.
