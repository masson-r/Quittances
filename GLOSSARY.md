# Gestion locative

Application web de gestion locative multi-propriétaires : patrimoine, baux, loyers, encaissements, dépenses et quittances. Les termes sont en français ; l'identifiant de table anglais correspondant est donné entre parenthèses.

## Identité et périmètres

**Structure propriétaire** (`ownership_entities`) :
Personne physique, SCI ou autre entité de détention qui possède des biens et constitue un périmètre de gestion étanche.
_Avoid_: Propriétaire (ambigu : désigne aussi la personne), compte, société

**Membre** (`entity_memberships`) :
Lien entre un utilisateur et une structure propriétaire, portant son rôle (administrateur, gestionnaire, lecteur, locataire) et son statut d'accès.
_Avoid_: Droit global, rôle du profil

**Opérateur** :
Personne qui exploite l'application et crée les structures ; il n'a aucun accès aux données d'une structure dont il n'est pas membre.
_Avoid_: Super-administrateur, administrateur global

**Profil** (`profiles`) :
Identité applicative d'un utilisateur authentifié, distincte de tout dossier locataire et de toute structure.
_Avoid_: Compte (désigne l'authentification), utilisateur

## Patrimoine et location

**Bien** (`properties`) :
Appartement géré par une structure propriétaire, archivable mais jamais supprimé s'il a un historique.
_Avoid_: Logement, appartement, lot

**Dossier locataire** (`tenants`) :
Fiche décrivant une personne locataire, indépendante de son compte utilisateur et de tout bail précis.
_Avoid_: Locataire (désigne la personne), client

**Bail** (`leases`) :
Contrat de location d'un bien sur une période donnée, associé à un ou plusieurs dossiers locataires (colocation).
_Avoid_: Contrat, location

**Conditions de loyer** (`rental_terms`) :
Version datée du loyer hors charges et des provisions sur charges d'un bail ; une nouvelle version ne modifie jamais les échéances déjà créées.
_Avoid_: Tarif, révision

## Finances

**Échéance** (`rent_charges`) :
Somme exigible d'un bail pour un mois civil, créée automatiquement à sa date d'échéance, unique par bail et période (hors annulées), dont le solde et le statut sont calculés.
_Avoid_: Appel de loyer, facture, loyer dû

**Paiement** (`payments`) :
Encaissement reçu et saisi manuellement, non affecté tant qu'il n'est pas rattaché à des échéances.
_Avoid_: Règlement, versement

**Affectation** (`payment_allocations`) :
Part d'un paiement imputée à une échéance ; seule source du montant réglé d'une échéance.
_Avoid_: Imputation, rapprochement

**Impayé** :
Échéance dont la date d'échéance est dépassée et dont le solde restant dû est positif.
_Avoid_: Retard (désigne la durée), dette

**Dépense** (`expenses`) :
Charge supportée par une structure pour un bien, rangée dans une catégorie.
_Avoid_: Frais, coût

**Apurement des charges** :
Ligne manuelle, positive (remboursement au locataire) ou négative (complément reçu), qui règle un écart de charges en cours ou en fin de bail ; un apurement final, éventuellement nul, est obligatoire à la fin de chaque bail.
_Avoid_: Régularisation des charges (désigne le calcul avancé, hors périmètre)

## Documents

**Quittance** (`receipts`) :
Document émis attestant qu'une période d'échéance est intégralement réglée, figé comme instantané des informations à l'émission.
_Avoid_: Reçu, facture, relevé (désigne seulement la mise en page)

**Signature du bailleur** :
Image PNG ou JPEG téléversée par le propriétaire, incluse dans la quittance et le reçu avec la mention « signé électroniquement » et l'identifiant du document.
_Avoid_: Signature électronique qualifiée

**Reçu de paiement partiel** :
Document attestant un paiement incomplet ; il n'est jamais une quittance.
_Avoid_: Quittance partielle

**Invitation** (`invitations`) :
Lien privé à usage unique, valable 14 jours et révocable, qui permet à un futur membre ou à un locataire de s'engager vers une structure ou un dossier.
_Avoid_: Lien d'inscription, code

**Demande de rattachement** :
Requête en attente d'un profil, créée en utilisant l'invitation d'un locataire, que le propriétaire valide ou refuse ; elle expire après 30 jours.
_Avoid_: Inscription

**Rattachement** (`tenant_account_links`) :
Association validée par le propriétaire entre un profil et un dossier locataire ; jamais automatique, révocable à tout moment par le propriétaire ou le locataire.
_Avoid_: Liaison, appariement par e-mail
