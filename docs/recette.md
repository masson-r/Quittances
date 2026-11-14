# Recette

La recette est faite **à la main par l'utilisateur, sur le staging**, d'abord avec des données fictives, puis avec la reprise d'historique réelle d'une structure. Elle est **signée et datée avant toute utilisation réelle**. Une case cochée = scénario vu fonctionner par la personne qui signe.

Prérequis : staging déployé et à jour, structure créée par l'opérateur (`pnpm operator:create-structure`), administrateur avec second facteur activé. Voir [exploitation/production.md](exploitation/production.md).

## 1. Scénarios

### Mise en service
- [ ] L'opérateur crée la structure ; l'administrateur invité accepte le lien, se connecte, active le second facteur et conserve ses codes de secours.
- [ ] Les sept catégories de dépenses existent ; l'administrateur peut en ajouter, renommer, archiver.
- [ ] Un membre (gestionnaire) invité par lien voit les bons menus ; un lecteur ne peut rien modifier.
- [ ] Sur mobile (390 px) : menu replié, pages utilisables au pouce.

### Cycle complet d'un bail
- [ ] Créer un bien, un dossier locataire, un bail avec deux colocataires ; l'échéance du mois apparaît à sa date.
- [ ] Changer les conditions de loyer en cours de bail ; vérifier le prorata d'un mois partiel.
- [ ] Saisir un paiement partiel : statut « partiellement payée », puis « en retard » le lendemain de l'échéance.
- [ ] Saisir le paiement complémentaire : échéance « payée ».
- [ ] Un paiement en avance reste « à affecter » puis s'affecte à l'échéance créée.
- [ ] Un paiement en espèces à partir de 1 000 € demande une confirmation.
- [ ] Terminer le bail, saisir l'apurement final (même nul).

### Quittances et reçus
- [ ] Reçu pour un paiement partiel : porte « REÇU — PAS UNE QUITTANCE » et le reste dû.
- [ ] Quittance d'une échéance soldée : dates d'émission et de paiement modifiables, détail des règlements, colocataires présents.
- [ ] Le PDF téléchargé est identique à celui du téléchargement précédent (jamais régénéré).
- [ ] Annuler un paiement qui a une quittance est refusé tant que la quittance n'est pas annulée ; annuler la quittance puis le paiement fonctionne.
- [ ] Remplacer une quittance : ancienne version conservée annulée, nouvelle numérotée.
- [ ] Téléverser sa signature (PNG/JPEG) : elle figure sur les quittances émises ensuite ; sans signature, mention « signé électroniquement » seule.

### Espace locataire
- [ ] Le propriétaire crée un lien ; le locataire s'inscrit (e-mail vérifié), coche le consentement, envoie la demande.
- [ ] Avant validation : aucune donnée visible. Le propriétaire voit l'écart d'e-mail éventuel et valide.
- [ ] Après validation : le locataire voit ses coordonnées, le résumé de ses baux et ses documents, **jamais** échéances, paiements ni soldes ; il télécharge une quittance **sur mobile**.
- [ ] Retrait du consentement : « remise papier demandée » côté propriétaire, les nouveaux documents ne sont plus en ligne.
- [ ] Révocation par le propriétaire : effet immédiat côté locataire.

### Dépenses et tableau de bord
- [ ] Saisir une dépense avec justificatif ; filtres par bien, catégorie, période ; annulation avec motif.
- [ ] Tableau de bord : indicateurs cohérents avec les saisies ; filtres 1, 2, 3, 5 ans ; vue « toutes mes structures » ; mention « n'est pas un résultat fiscal ».
- [ ] Page Impayés : échéances en retard par ancienneté, lien vers le bail.

### Accès refusés
- [ ] Un membre d'une autre structure obtient « introuvable » en tapant l'adresse d'une page ou d'un document.
- [ ] Un locataire ne peut pas ouvrir le document d'un autre locataire ni une page d'espace propriétaire.
- [ ] Un lien de téléchargement expire au bout de 60 secondes.
- [ ] Un profil désactivé est déconnecté à la requête suivante.

### Reprise d'historique (données réelles)
- [ ] `--dry-run` sur les vrais fichiers : totaux par bail et par année conformes aux documents de l'utilisateur ; échéances impayées attendues ; aucun écart inexpliqué.
- [ ] Import réel, puis vérification par sondage de trois mois dans l'application ; quittance d'une échéance ancienne émise avec dates passées.
- [ ] Fichiers CSV supprimés du poste de l'opérateur après contrôle.

## 2. Revue visuelle de la variante C (PDF)

Revue humaine, une seule fois, sur une quittance et un reçu partiel réels du staging (ouvrir le PDF, pas seulement le texte extrait) :

- [ ] Bande verticale : bleue pour la quittance, orange pour le reçu ; puce de genre lisible.
- [ ] Période en grand, trois colonnes (bailleur, locataires, logement) sans débordement, y compris avec trois colocataires et une longue adresse.
- [ ] Frise des règlements lisible (1, 2, 4 règlements) ; au-delà de quatre, liste.
- [ ] Jauge reçu sur échéance, « Soldé le … » ou « Reste dû … ».
- [ ] Montants en chiffres et en lettres cohérents ; phrase de déclaration adaptée au genre du document.
- [ ] Signature : image nette et bien proportionnée ; mention « signé électroniquement » et identifiant du document.
- [ ] Mentions de conservation (3 ans) et de gratuité en pied de page ; impression en noir et blanc lisible.

## 3. Jalons ouverts (L6-04, tâche humaine)

À lever **avant** l'utilisation réelle, décisions consignées dans des ADR :

- [ ] Durée de conservation comptable côté bailleur.
- [ ] Relecture de l'article 21 de la loi n° 89-462 sur Légifrance ; L. 112-6 et L. 112-7 (plafond des espèces) ; article 8-1 (solidarité des colocataires).
- [ ] Sauvegardes supplémentaires du Storage (ADR 0005) : décision prise ou risque accepté par écrit.
- [ ] Accord de sous-traitance relu et signé ([exploitation/accord-sous-traitance.md](exploitation/accord-sous-traitance.md)).

## 4. Signature de la recette

| | |
|---|---|
| Version (commit) recettée | |
| Environnement | |
| Scénarios 1 à 3 validés | ☐ |
| Recette signée par | |
| Date | |

> Aucune donnée réelle avant que cette section soit signée et datée.
