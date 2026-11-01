---
title: Gestion locative — proposition initiale à valider
label: wayfinder:map
---

## Destination

La **proposition initiale validée** du README §17 : architecture technique, modèle relationnel, migrations initiales (conçues, non écrites), matrice des autorisations, parcours utilisateurs, règles financières, backlog priorisé en tickets avec dépendances et critères d'acceptation, stratégie de test, registre des risques. Aucun code applicatif n'est produit par cette carte ; le backlog des Lots 0 à 6 (README §11) se construit ensuite, dans d'autres sessions.

## Notes

- Domaine : gestion locative française, habitation, multi-propriétaires. Source de vérité du besoin : [README.md](../../README.md). Vocabulaire : [GLOSSARY.md](../../GLOSSARY.md).
- Langue : conversation, prose, tickets et glossaire en **français** ; identifiants de base de données en **anglais** (correspondance dans le glossaire).
- Tracker : **markdown local**. Un ticket est un fichier `docs/wayfinder/tickets/NNN-slug.md` avec en en-tête `type`, `status` (`open` ou `closed`), `assignee` (la réclamation) et `blocked_by` (liste de fichiers). La frontière est l'ensemble des tickets `open`, sans `assignee`, dont tous les `blocked_by` sont `closed`.
- Planifier, ne pas faire : chaque ticket produit une décision. Les prototypes sont jetables et ne rejoignent jamais l'application. Un prototype est autorisé surtout pour la mise en page de la quittance PDF (l'utilisateur veut un exemple).
- Décisions de cadrage (prises pendant la définition de la destination, hors tickets) :
  - Baux d'habitation uniquement, vides ou meublés, charges en provisions. Pas de charges forfaitaires, baux commerciaux, garage ou parking.
  - Dépôt de garantie : simple champ informatif sur le bail (montant, date de réception), sans logique financière.
  - Colocation : une quittance par bail et par période, tous les colocataires nommés, sans répartition par personne.
  - Prorata d'entrée et de sortie : jours réels du mois, une seule règle, paramètre stocké sur le bail.
  - Le rôle « locataire » n'est pas une ligne de `entity_memberships` : l'accès locataire découle du rattachement validé. Seuls administrateur, gestionnaire et lecteur sont des membres.
  - Corrections : annulation par écriture inverse avec motif, versions conservées, tout tracé dans `audit_logs`.
  - Apurement des charges (README §5.12), codes d'accès et commentaires de maintenance des biens : en périmètre, en saisie manuelle simple.
- Les ressources `research` sont produites par des sous-agents sur des branches `research/<nom>` jamais fusionnées ; le dépôt n'a pas de remote, donc rien n'est poussé.

## Decisions so far

<!-- une ligne par ticket fermé : [titre](lien) : gist de la réponse -->

- [Cadre légal des quittances et mentions obligatoires](tickets/001-cadre-legal-quittances.md) : la loi n'impose que le détail loyer et charges ; reçu partiel distinct de la quittance ; remise gratuite sur demande, dématérialisée avec accord exprès à stocker ; espèces plafonnées à 1 000 € ; une quittance par bail cohérente.
- [Obligations RGPD et hébergement des données](tickets/002-rgpd-et-hebergement.md) : propriétaire responsable de traitement et éditeur sous-traitant (accord art. 28) ; date de naissance facultative ; archive de 3 ans après clôture ; Supabase Paris et Vercel `cdg1` à fixer explicitement.
- [Règles financières des échéances, paiements et soldes](tickets/003-regles-financieres.md) : échéance créée à sa date d'échéance, sans génération à l'avance ni statut « À venir » ; prorata en jours réels arrondi au centime ; affectation proposée puis validée ; corrections tracées et annulations conservées ; quittance sur action explicite avec dates modifiables.
- [Matrice des autorisations et stratégie RLS](tickets/004-matrice-autorisations.md) : trois rôles fixes (gestionnaire = tout l'opérationnel, administrateur = en plus structure, membres, audit, lecteur = consultation) ; RLS partout sans suppression sur le financier ; champs sensibles en tables séparées ; droits relus à chaque requête ; fichiers par route serveur et lien de 60 secondes ; structures créées par l'opérateur.
- [Parcours d'inscription et de rattachement du locataire](tickets/005-parcours-rattachement-locataire.md) : lien privé à usage unique de 14 jours pour membres et locataires ; demande « en attente » validée par le propriétaire, jamais sur e-mail seul ; consentement horodaté à la remise dématérialisée ; un profil pour plusieurs dossiers, un dossier pour un profil actif ; pas de révocation automatique.
- [Mise en page de la quittance et du reçu partiel en PDF](tickets/006-mise-en-page-quittance-pdf.md) : variante C (relevé compact avec frise et jauge) retenue ; image de signature téléversée par le propriétaire, mention « signé électroniquement » et identifiant du document.
- [Architecture technique, environnements et déploiement](tickets/008-architecture-technique.md) : monolithe par domaine, opérations financières en fonctions SQL, échéances par `pg_cron`, PDF généré une fois avec empreinte, TOTP obligatoire pour les membres, trois environnements, déploiement de production après migration, CI bloquante ; sauvegardes supplémentaires reportées, risque accepté.
- [Modèle relationnel et contraintes de la base](tickets/007-modele-relationnel.md) : `entity_id` et clés composites partout, montants en centimes, échéance stockant l'appelé et soldes et statuts calculés par vue, annulations par `cancelled_*` sans suppression, `receipts` unique avec instantané, signature facultative par structure, `audit_logs` en ajout seul sur 3 ans, anonymisation manuelle des dossiers.
- [Stratégie de test et critères d'acceptation transverses](tickets/009-strategie-de-test.md) : unitaires, intégration sur Supabase local et six parcours Playwright ; RLS testée par matrice déclarative avec test de garde ; PDF vérifiés par extraction de texte et empreinte ; seuil de 100 % des branches sur les fonctions financières pures ; liste de critères d'acceptation et recette signée avant l'utilisation réelle ; échelle de trois baux en parallèle.
- [Indicateurs et vues du tableau de bord](tickets/010-indicateurs-tableau-de-bord.md) : appelé par date d'échéance, encaissé par date de réception, solde de trésorerie estimé non fiscal, restant dû et impayés calculés à ce jour avec liens vers les baux ; périodes de 1, 2, 3 et 5 ans, par appartement ou pour l'ensemble ; trois fonctions SQL à la demande sans total stocké.
- [Apurement des charges : saisie manuelle du remboursement](tickets/011-apurement-des-charges.md) : table `charge_settlements` à montant signé (remboursé ou complément reçu), un apurement final obligatoire par bail (éventuellement nul) avec alerte et blocage de l'anonymisation, aucun effet sur échéances, soldes et quittances, indicateur net distinct de l'encaissé.
- [Reprise de l'historique de location déjà réalisé](tickets/012-reprise-historique-location.md) : script de l'opérateur avec modèles CSV, `--dry-run` et rapport de totaux, lot tout ou rien rejeté en entier au moindre échec, rejeu sans doublon par `external_ref`, cinq ans au moins en détail, quittances anciennes émises seulement à la demande, annulation d'un lot en bloc.

## Not yet specified

- **Durée de conservation comptable côté bailleur** : à confirmer avant l'utilisation réelle (point ouvert de la recherche RGPD, textes L123-22 et L102 B non vérifiés) ; conditionne l'usage de la fonction d'anonymisation.

## Out of scope

- Intégration et synchronisation bancaires automatiques (README §16).
- Envoi automatique de relances par e-mail.
- Signature électronique des baux.
- Comptabilité complète et déclaration fiscale automatisée.
- Calcul automatique des révisions légales de loyer.
- Régularisation avancée des charges (calcul annuel ; seul l'apurement manuel est en périmètre).
- Application mobile native et architecture microservices.
- Baux non résidentiels, charges forfaitaires, logique du dépôt de garantie (décisions de cadrage).
