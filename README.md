## 1. Présentation du projet

### 1.1. Contexte

Je souhaite développer une application web de gestion locative afin de simplifier la gestion de plusieurs appartements et de leurs locataires.

L'application doit permettre de centraliser les informations relatives au patrimoine immobilier, aux contrats de location, aux loyers, aux encaissements, aux dépenses et aux quittances.

Elle doit proposer deux espaces fonctionnels distincts :
- Un espace propriétaire, destiné à la gestion du patrimoine et au suivi financier.
- Un espace locataire, permettant de consulter et de télécharger les quittances de loyer personnelles.

L'application doit être conçue dès le départ pour gérer plusieurs propriétaires et plusieurs structures juridiques, avec une séparation stricte des données et des autorisations.

Il s'agit initialement d'une application de gestion locative privée, qui doit néanmoins reposer sur une architecture suffisamment propre pour évoluer ultérieurement.

### 1.2. Objectifs

Les objectifs principaux sont :
- Centraliser la gestion des appartements et des contrats de location.
- Gérer plusieurs structures propriétaires et plusieurs utilisateurs autorisés.
- Suivre les loyers attendus, les paiements reçus et les impayés.
- Gérer les paiements partiels et les régularisations.
- Conserver l'historique des conditions de loyer.
- Enregistrer les dépenses associées aux biens.
- Générer et archiver les quittances de loyer.
- Donner aux locataires un accès autonome et sécurisé à leurs documents.
- Fournir un tableau de bord financier global et par appartement.
- Disposer d'une application responsive, maintenable et déployée automatiquement.

## 2. Principes de conception

L'application doit respecter les principes suivants :

- Sécurité et confidentialité des données dès la conception.
- Séparation des responsabilités entre les modules métier.
- Modèle de données relationnel cohérent.
- Conservation de l'historique des opérations financières et documentaires.
- Validation des règles métier côté serveur.
- Autorisations contrôlées à chaque accès aux données.
- Interface simple, claire et entièrement en français.
- Développement progressif, avec tests à chaque étape.
- Absence de dépendance à une intégration bancaire pour le MVP.
- Pas de sur-ingénierie : privilégier une architecture modulaire et un monolithe bien structuré.

Ne jamais considérer une fonctionnalité comme terminée uniquement parce que son interface est disponible.

## 3. Stack technique imposée

### Frontend et backend

- Next.js avec App Router.
- TypeScript en mode strict.
- React.
- Tailwind CSS.
- Bibliothèque de composants accessible et réutilisable, par exemple shadcn/ui.
- Validation des entrées avec Zod.
- Logique métier centralisée dans des services côté serveur.

### Base de données et authentification

- Supabase.
- PostgreSQL comme base de données relationnelle.
- Supabase Auth pour l'authentification.
- Row Level Security (RLS) pour le cloisonnement des données.
- Migrations SQL versionnées dans le dépôt Git.

### Documents

- Supabase Storage.
- Bucket privé pour les quittances et pièces justificatives.
- Génération des PDF côté serveur.
- Téléchargement sécurisé après vérification des autorisations.

### Qualité et tests

- Vitest pour les tests unitaires.
- Tests d'intégration pour les services métier et les accès aux données.
- Playwright pour les tests end-to-end.
- ESLint et vérification TypeScript.
- CI GitHub Actions pour automatiser les contrôles.

### Hébergement et versionnement

- GitHub pour le code source.
- Vercel pour l'hébergement et le déploiement.
- Déploiements Preview pour les branches et pull requests.
- Environnements distincts pour le développement, la préproduction si nécessaire et la production.
- Secrets configurés dans les environnements appropriés, jamais dans le code source.

Ne pas ajouter de framework, de service externe ou de dépendance importante sans justification technique.

## 4. Organisation des utilisateurs et des structures

### 4.1. Comptes utilisateurs

Chaque utilisateur possède un compte d'authentification unique.

Le profil applicatif contient les informations nécessaires à son utilisation de l'application :
- Identifiant utilisateur.
- Nom et prénom.
- Adresse e-mail.
- Statut du compte.
- Date de création.
- Date de dernière mise à jour.

Le profil applicatif doit être distinct des dossiers locataires et des structures propriétaires.

Un même utilisateur peut disposer de plusieurs rôles selon le contexte auquel il accède.

### 4.2. Structures propriétaires

L'application doit gérer plusieurs structures propriétaires.

Une structure peut représenter :
- Une personne physique.
- Une SCI.
- Une autre personne morale ou structure de détention.

Chaque structure contient au minimum :
- Un identifiant.
- Un nom ou une dénomination.
- Un type de structure.
- Des coordonnées.
- Des informations administratives facultatives.
- Un statut actif ou archivé.

Chaque structure possède son propre périmètre de gestion.

Un utilisateur peut gérer plusieurs structures. Une structure peut être gérée par plusieurs utilisateurs autorisés.

### 4.3. Membres et rôles

Mettre en place une table d'association entre utilisateurs et structures.

Prévoir au minimum les rôles suivants :
- Administrateur de structure : gestion de la structure et de ses membres.
- Gestionnaire : gestion opérationnelle des biens, baux et finances.
- Lecteur : consultation des informations autorisées.
- Locataire : accès limité à ses propres informations et documents.

Les rôles doivent être contrôlés côté serveur. Les droits ne doivent pas être déterminés uniquement par l'interface ou par un champ de rôle global dans le profil.

Le modèle doit permettre d'ajouter ultérieurement d'autres permissions sans refonte majeure.

## 5. Espace propriétaire

### 5.1. Tableau de bord

Le propriétaire dispose d'un tableau de bord synthétique avec :
- Nombre de biens actifs.
- Nombre de baux en cours.
- Nombre de locataires actifs.
- Loyers attendus sur la période.
- Montants encaissés.
- Montants restant dus.
- Impayés échus.
- Dépenses enregistrées.
- Solde financier estimé.
- Évolution mensuelle des recettes et dépenses.
- Comparaison des performances financières par bien.
- Dernières opérations enregistrées.

Le tableau de bord doit être filtrable :
- Par structure.
- Par appartement.
- Par mois, trimestre ou année.
- Par période personnalisée.

Les indicateurs doivent être calculés à partir des données financières de référence. Ne pas maintenir de totaux redondants susceptibles de devenir incohérents.

Distinguer les loyers appelés, les encaissements réels, les soldes dus et les dépenses. Le solde financier affiché ne doit pas être présenté comme un résultat fiscal.

### 5.2. Gestion des biens immobiliers

Le propriétaire peut créer, consulter, modifier et archiver des appartements.

Chaque bien contient :
- Identifiant unique.
- Structure de gestion.
- Nom ou libellé.
- Adresse complète.
- Complément d'adresse facultatif.
- Description facultative.
- Statut actif ou archivé.
- Dates de création et de mise à jour.
- Code d'accès aux différentes portes
- Commentaires historique pour la maintenance

Un bien est rattaché à un périmètre de gestion déterminé.

La suppression physique d'un bien ayant un historique financier ou locatif doit être interdite. Son archivage doit conserver les liens vers les baux, les dépenses et les documents historiques.

Prévoir une page de détail présentant les informations du bien, ses baux, ses locataires, ses échéances, ses paiements et ses dépenses.

### 5.3. Gestion des dossiers locataires

Un dossier locataire est distinct du compte utilisateur.

Chaque dossier contient :
- Nom et prénom.
- Adresse e-mail.
- Coordonnées facultatives.
- Informations nécessaires à la gestion du bail.
- Statut du dossier.
- Compte utilisateur associé, lorsqu'un rattachement a été validé.
- Type de garant
- Informations garant
- Info Aide aux Logements (APL)
- Date de naissance

Le propriétaire peut :
- Créer un dossier locataire.
- Modifier ses informations.
- L'associer à un bail.
- Consulter son historique locatif.
- Initier ou valider son rattachement à un compte.
- Consulter les quittances émises.

Le système doit gérer plusieurs locataires pour un même bail, notamment en colocation, et un locataire ayant occupé plusieurs logements au fil du temps.

Ne pas imposer une relation permanente entre un locataire et un seul appartement.

### 5.4. Gestion des baux

Un bail représente le contrat de location d'un bien.

Il contient :
- Le bien concerné.
- La structure propriétaire.
- La date de début.
- La date de fin éventuelle.
- Le statut du bail.
- Le jour d'échéance du loyer.
- Les conditions financières applicables.
- Les locataires associés.
- Les dates de création et de mise à jour.

Le système doit conserver l'historique des baux successifs pour un même appartement.

Les changements de locataires ne doivent pas modifier rétroactivement les anciens baux ou les quittances déjà émises.

Les entrées et sorties en cours de mois doivent être prises en charge selon des règles de proratisation explicites, configurables si nécessaire.


### 5.5. Historique des conditions de loyer

Les conditions financières sont historisées dans une table dédiée.

Chaque version contient :
- Le bail concerné.
- Le loyer hors charges.
- Les provisions sur charges.
- La date de début d'application.
- La date de fin d'application éventuelle.
- La référence ou le motif de la modification.

Une modification de loyer prend effet à une date déterminée.

Elle ne doit jamais modifier les montants des échéances déjà créées.

Toute nouvelle échéance doit utiliser les conditions applicables à la période concernée.

Les révisions de loyer doivent être saisies ou validées par un utilisateur autorisé. Le calcul automatique d'une révision légale ne fait pas partie du MVP.

### 5.6. Gestion des échéances

Le système doit créer les échéances de loyer pour les baux actifs.

Chaque échéance comprend :
- Le bail.
- La période concernée.
- La date d'échéance.
- Le montant du loyer.
- Le montant des charges.
- Le total exigible.
- Le montant affecté par les paiements.
- Le solde restant dû.
- Le statut financier calculé.

Une échéance doit être unique pour un bail et une période donnée.

La génération des échéances doit être idempotente : son exécution répétée ne doit jamais créer de doublons.

Les échéances doivent pouvoir être générées à l'avance sur une période définie.

La gestion des proratas, des changements de conditions et des fins de bail doit être documentée et testée.

### 5.7. Gestion manuelle des paiements

Le propriétaire saisit manuellement chaque encaissement reçu.

Un paiement contient :
- Identifiant unique.
- Structure concernée.
- Date de réception.
- Montant reçu.
- Mode de paiement.
- Référence facultative.
- Commentaire facultatif.
- Utilisateur ayant saisi le paiement.
- Date de création.

Les modes de paiement peuvent comprendre le virement, le chèque, les espèces lorsque légalement applicables et les autres moyens pertinents.

L'enregistrement d'un paiement ne doit pas déclencher automatiquement une quittance.

Le système doit gérer :
- Les paiements partiels.
- Les paiements couvrant plusieurs échéances.
- Les échéances réglées en plusieurs fois.
- Les paiements reçus en avance.
- Les montants restant non affectés.
- Les erreurs de saisie et leur correction tracée.

### 5.8. Affectation des paiements

Utiliser une table de liaison entre paiements et échéances.

Cette table permet :
- D'affecter un paiement à une ou plusieurs échéances.
- D'affecter plusieurs paiements à une même échéance.
- De conserver l'historique des affectations.
- De calculer le solde de chaque échéance.

Les contrôles doivent empêcher :
- Une affectation supérieure au montant disponible du paiement.
- Une affectation supérieure au solde de l'échéance.
- Une double affectation du même montant.
- Une affectation entre des périmètres incompatibles.

Les paiements validés ne sont pas supprimés physiquement. Toute correction doit être auditée.

### 5.9. Suivi des impayés

Le système identifie automatiquement les échéances en retard.

Statuts financiers minimaux :
- À venir.
- À payer.
- Partiellement payée.
- Payée.
- En retard.

Le statut est calculé à partir de la date d'échéance et du solde restant dû.

Le propriétaire doit pouvoir consulter :
- Les échéances en retard.
- Le montant total des impayés échus.
- Le détail des paiements déjà reçus.
- Le nombre de jours de retard.
- L'historique des régularisations.

Ne pas calculer les pénalités de retard automatiquement dans le MVP.

### 5.10. Gestion des dépenses

Le propriétaire peut enregistrer les dépenses associées à une structure et à un appartement.

Une dépense contient :
- Identifiant.
- Structure concernée.
- Appartement concerné.
- Date de dépense.
- Catégorie.
- Description.
- Montant.
- Statut.
- Justificatif facultatif.
- Date de création.
- Utilisateur ayant enregistré la dépense.

Catégories initiales :
- Travaux.
- Entretien et réparations.
- Assurance.
- Taxe foncière.
- Charges de copropriété.
- Frais de gestion.
- Autres dépenses.

Prévoir un champ indiquant si la dépense est potentiellement récupérable auprès du locataire, sans automatiser la régularisation des charges dans le MVP.

Les dépenses peuvent être filtrées par structure, bien, catégorie et période.

### 5.11. Gestion des quittances

Le propriétaire peut générer les quittances correspondant aux périodes intégralement réglées.

Une quittance doit contenir :
- Identité et coordonnées du bailleur.
- Identité du ou des locataires.
- Adresse du logement.
- Période concernée.
- Montant du loyer hors charges.
- Montant des charges.
- Total payé.
- Date de paiement.
- Date d'émission.
- Identifiant unique du document.

Le PDF doit être généré côté serveur et conservé dans un espace de stockage privé.

La quittance doit conserver un instantané des informations utilisées lors de son émission. Une modification ultérieure du loyer, de l'adresse ou du profil ne doit pas modifier le document historique.

Un reçu de paiement partiel doit être distinct d'une quittance complète.

Les documents émis ne doivent pas être supprimés silencieusement. Les corrections doivent suivre un processus explicite et traçable.

### 5.12. Apurement des charges
On pourra ajouter manuellement le remboursement des charges trop percu, en apurement de charge.
Cela arrive en fin de bail ou durant le bail.


## 6. Espace locataire

### 6.1. Inscription autonome

Un locataire peut créer son propre compte depuis une page publique.

Le parcours comprend :
1. Saisie de l'adresse e-mail et du moyen d'authentification retenu.
2. Vérification de l'adresse e-mail.
3. Connexion au compte.
4. Demande de rattachement à un dossier existant.
5. Validation du rattachement par le propriétaire.
6. Accès aux documents autorisés.

Le MVP peut utiliser un code d'invitation à usage unique ou un lien privé sécurisé.

Les invitations doivent avoir une durée de validité, être consommables une seule fois et être révocables.

Ne jamais associer automatiquement un compte à un dossier sur la seule base d'une adresse e-mail déclarée.

### 6.2. Consultation des quittances

Une fois le rattachement validé, le locataire peut :
- Consulter la liste de ses quittances.
- Filtrer les documents par période.
- Consulter les informations principales d'une quittance.
- Télécharger le PDF correspondant.

Il ne peut pas :
- Modifier un bail.
- Enregistrer un paiement.
- Consulter les dépenses.
- Consulter les données internes du propriétaire.
- Consulter les informations d'un autre locataire.
- Accéder aux fichiers d'un autre utilisateur.

L'accès doit être limité aux documents associés à ses baux et à ses droits effectifs.

Le portail locataire doit être responsive et simple à utiliser sur mobile.

## 7. Modèle de données

Prévoir au minimum les tables suivantes :

### Identité et autorisations

- profiles : profil applicatif lié à Supabase Auth.
- ownership_entities : personnes ou structures propriétaires.
- entity_memberships : membres, rôles et statuts d'accès.

### Patrimoine et location

- properties : biens immobiliers.
- tenants : dossiers locataires.
- leases : contrats de location.
- lease_tenants : association entre baux et locataires.
- rental_terms : historique des conditions de loyer.

### Finances

- rent_charges : échéances de loyer.
- payments : encaissements enregistrés.
- payment_allocations : affectation des paiements aux échéances.
- expenses : dépenses immobilières.

### Documents et traçabilité

- receipts : métadonnées des quittances.
- tenant_account_links : demandes et rattachements de comptes locataires.
- invitations : invitations sécurisées.
- documents : métadonnées des pièces justificatives.
- audit_logs : journal des opérations sensibles.

Les noms peuvent être adaptés si une convention cohérente est retenue, mais les responsabilités de chaque entité doivent être préservées.

Toutes les relations doivent être définies explicitement avec clés étrangères, contraintes, index et règles de suppression appropriées.

Les montants sont stockés en centimes entiers ou dans un type décimal exact.

Les dates métier sont définies avec une sémantique claire, et les horodatages techniques sont conservés en UTC.

Ne pas stocker comme source de vérité un solde ou un statut calculable à partir des paiements et des échéances, sauf justification technique documentée.

## 8. Sécurité et confidentialité

La sécurité constitue un critère d'acceptation pour toutes les fonctionnalités.

Exigences :
- Authentification obligatoire pour les espaces privés.
- Vérification de l'adresse e-mail.
- Gestion sécurisée des sessions.
- Contrôle des rôles et permissions côté serveur.
- RLS PostgreSQL pour les données concernées.
- Vérification de l'appartenance au bon périmètre pour chaque opération.
- Contrôle d'accès aux fichiers privés.
- Liens de téléchargement temporaires lorsque nécessaire.
- Validation des données avec Zod.
- Protection contre les accès directs à des identifiants appartenant à d'autres utilisateurs.
- Protection des routes, API et Server Actions.
- Absence de clés secrètes dans le navigateur.
- Absence de secrets dans GitHub.
- Journalisation des opérations financières et documentaires sensibles.
- Gestion des comptes désactivés et des rattachements révoqués.

Les tests doivent couvrir les accès non autorisés, notamment entre structures propriétaires, entre locataires et entre baux.

La clé Supabase service_role ne doit jamais être exposée au navigateur. Toute utilisation privilégiée côté serveur doit être limitée et précédée de vérifications d'autorisation adaptées.

Les données personnelles ne doivent être collectées que dans la mesure nécessaire au fonctionnement du service.

## 9. Interface utilisateur

L'interface est en français.

Utiliser :
- L'euro comme devise.
- Les formats de dates français.
- Des tableaux lisibles.
- Des formulaires avec validation.
- Des filtres et une recherche.
- Des confirmations pour les opérations sensibles.
- Des états de chargement et des états vides explicites.
- Des messages d'erreur compréhensibles.
- Une navigation responsive.

### Navigation propriétaire

- Tableau de bord.
- Structures.
- Biens immobiliers.
- Locataires.
- Baux.
- Échéances et paiements.
- Impayés.
- Dépenses.
- Quittances.
- Membres et paramètres.

### Navigation locataire

- Mon espace.
- Mes quittances.
- Mes informations.
- Mes demandes de rattachement.

L'interface doit rester simple et privilégier la lisibilité des données financières.

## 10. Architecture logicielle

Adopter un monolithe modulaire Next.js.

Séparer :
- Les composants d'interface.
- Les routes et pages.
- Les schémas de validation.
- Les services métier.
- Les accès à la base de données.
- Les contrôles d'autorisation.
- Les traitements de documents.
- Les tests.

Les règles financières ne doivent pas être dispersées dans les composants React.

Les opérations sensibles doivent être exécutées côté serveur, dans des services testables.

Les transactions financières et les affectations de paiements doivent être atomiques lorsqu'elles nécessitent plusieurs écritures.

Les traitements répétables, comme la génération d'échéances, doivent être idempotents.

Les migrations de base de données doivent être versionnées et reproductibles.

Ne pas introduire de microservices ou de système de tâches complexe sans besoin réel démontré.

## 11. Backlog de réalisation

### Lot 0 — Initialisation technique

- Créer le projet Next.js.
- Configurer TypeScript, Tailwind CSS et les composants.
- Initialiser GitHub.
- Configurer Supabase et les environnements.
- Configurer Vercel.
- Mettre en place les migrations et la CI.
- Rédiger le README et le fichier .env.example.

Critère de validation : le projet démarre localement et se déploie correctement sur Vercel.

### Lot 1 — Authentification et structures

- Implémenter l'authentification.
- Créer les profils.
- Gérer les structures.
- Gérer les membres et leurs rôles.
- Configurer les premières politiques RLS.
- Écrire les tests de cloisonnement.

Critère de validation : aucun utilisateur ne peut accéder aux données d'une structure non autorisée.

### Lot 2 — Biens, locataires et baux

- CRUD des biens.
- CRUD des dossiers locataires.
- Création et modification des baux.
- Gestion de la colocation.
- Historique des occupations.
- Historique des conditions de loyer.

Critère de validation : plusieurs locataires et plusieurs baux successifs sont gérés sans perte d'historique.

### Lot 3 — Échéances et paiements

- Génération des échéances.
- Enregistrement manuel des paiements.
- Affectation des paiements.
- Gestion des paiements partiels.
- Calcul des soldes.
- Détection des retards et impayés.
- Corrections financières tracées.

Critère de validation : les montants et statuts restent exacts dans tous les scénarios testés.

### Lot 4 — Portail locataire et quittances

- Inscription autonome.
- Vérification de l'adresse e-mail.
- Demande et validation du rattachement.
- Génération des quittances PDF.
- Stockage privé.
- Historique des documents.
- Téléchargement sécurisé.

Critère de validation : chaque locataire accède exclusivement aux documents qui lui sont destinés.

### Lot 5 — Dépenses et dashboard

- Enregistrement des dépenses.
- Gestion des catégories.
- Filtres par période et par bien.
- Indicateurs financiers.
- Graphiques d'évolution.
- Comparaison des appartements.

Critère de validation : les indicateurs concordent avec les données financières de référence.

### Lot 6 — Recette et production

- Tests unitaires.
- Tests d'intégration.
- Tests end-to-end.
- Tests d'accès non autorisés.
- Vérification des sauvegardes.
- Procédure de restauration.
- Vérification des migrations.
- Documentation de production.

Critère de validation : tous les tests bloquants passent et le déploiement de production est documenté.

## 12. Qualité et stratégie de test

Chaque lot doit comprendre des tests adaptés.

Tester notamment :
- La génération sans doublons des échéances.
- Les changements de loyer.
- Les périodes de bail.
- Les paiements partiels.
- Les paiements couvrant plusieurs échéances.
- Les trop-perçus et paiements non affectés.
- Les corrections et annulations.
- Les impayés.
- L'émission des quittances.
- Les inscriptions et rattachements.
- Les accès aux PDF.
- Les autorisations entre structures.
- Les autorisations entre locataires.
- Les erreurs de validation.
- Les scénarios d'utilisation sur mobile.

Toute règle financière importante doit être couverte par des tests unitaires.

Toute frontière de sécurité doit être couverte par des tests d'intégration.

Les parcours critiques doivent être validés par des tests end-to-end.

## 13. Déploiement et exploitation

Prévoir :
- Un environnement de développement.
- Un environnement Preview.
- Un environnement de production.
- Des variables d'environnement distinctes.
- Des migrations versionnées.
- Des sauvegardes adaptées à la criticité des données.
- Une procédure de restauration testée.
- Des logs exploitables sans données personnelles excessives.
- Des contrôles automatisés avant mise en production.

Ne jamais lancer une migration destructive automatiquement en production.

La documentation doit permettre à un développeur de reprendre le projet sans dépendre d'un contexte de conversation.

## 14. Méthode de travail de Claude Code via Wayfinder

Le développement doit être progressif et guidé par les spécifications.

Avant de coder :
1. Analyser l'ensemble des exigences.
2. Identifier les ambiguïtés métier.
3. Proposer l'architecture détaillée.
4. Définir le modèle relationnel.
5. Définir les autorisations.
6. Décomposer le backlog en tickets indépendants.
7. Définir les critères d'acceptation et les tests.

Ne pas commencer par générer toute l'application en un seul bloc.

Pour chaque ticket :
1. Vérifier ses dépendances.
2. Comprendre les règles métier concernées.
3. Implémenter le minimum nécessaire.
4. Ajouter ou mettre à jour les migrations.
5. Ajouter les tests.
6. Exécuter les contrôles de qualité.
7. Corriger les échecs.
8. Documenter les choix significatifs.
9. Vérifier les critères d'acceptation.
10. Présenter le résultat et les éventuels points bloquants.

Ne pas marquer un ticket terminé si ses tests échouent ou si ses critères d'acceptation ne sont pas satisfaits.

Ne pas modifier les règles métier sans documenter la modification et ses conséquences.

Ne pas introduire de dépendance externe ou de modification architecturale importante sans justification.

Ne pas effectuer de déploiement destructif ou de modification irréversible de la production sans validation explicite.

## 15. Definition of Done

Une fonctionnalité est terminée lorsque :
- Son comportement correspond aux spécifications.
- Les règles métier sont implémentées côté serveur.
- Les autorisations sont contrôlées.
- Les tests pertinents existent et passent.
- Le typage et le lint passent.
- Les migrations sont versionnées.
- Les erreurs sont correctement gérées.
- La documentation est à jour.
- Les critères d'acceptation sont vérifiés.
- Aucun secret ou document sensible n'est exposé.

## 16. Périmètre exclu du MVP

Ne pas développer initialement :
- L'intégration bancaire automatique.
- La synchronisation avec les comptes bancaires.
- L'envoi automatique de relances par e-mail.
- La signature électronique des baux.
- La comptabilité complète.
- La déclaration fiscale automatisée.
- Le calcul automatique des révisions légales de loyer.
- La gestion avancée des régularisations de charges.
- Une application mobile native.
- Une architecture microservices.

Ces fonctionnalités pourront faire l'objet d'évolutions ultérieures.

## 17. Livrable initial attendu

La première intervention doit produire une proposition structurée contenant :
- L'architecture technique détaillée.
- Le diagramme relationnel.
- Les migrations initiales proposées.
- La matrice des autorisations.
- Les principaux parcours utilisateurs.
- Les règles métier financières.
- Le backlog priorisé sous forme de tickets.
- Les dépendances entre tickets.
- Les critères d'acceptation.
- La stratégie de tests.
- Les risques techniques et métier identifiés.

Attendre la validation de cette proposition avant de générer l'ensemble du code applicatif.

Le résultat attendu est une application de gestion locative fiable, sécurisée, maintenable et évolutive, dont les règles financières et les contrôles d'accès sont vérifiables par des tests.