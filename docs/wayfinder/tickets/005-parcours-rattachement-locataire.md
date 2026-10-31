---
title: Parcours d'inscription et de rattachement du locataire
type: grilling
status: closed
assignee: massonr
blocked_by:
  - 004-matrice-autorisations.md
---

## Question

Comment un locataire obtient-il l'accès à ses quittances ? À trancher avec l'utilisateur :
- invitation par code à usage unique ou lien privé (durée de validité, révocation, nombre d'essais) ;
- méthode d'authentification du locataire (e-mail et mot de passe, lien magique) ;
- qui initie le rattachement et comment le propriétaire le valide ;
- cas particuliers : même personne dans plusieurs baux, colocataires, changement d'adresse e-mail, révocation après fin de bail ;
- ce que le locataire voit avant et après validation.
- stockage du consentement exprès du locataire à la remise dématérialisée des quittances (exigé par l'art. 21, voir le ticket clos sur le cadre légal).

Décisions issues du ticket clos sur les autorisations : le mécanisme d'invitation est commun aux membres et aux locataires ; le locataire rattaché ne voit que quittances, reçus, son dossier (sans garant ni aide au logement) et un résumé de ses baux ; l'accès aux quittances persiste après la fin du bail jusqu'à révocation, dont les règles restent à fixer ici ; droits relus en base à chaque requête, effet immédiat de la révocation.

## Résolution

Décidé avec l'utilisateur, en grilling.

**Invitations (membres et locataires)**
- Deux types d'invitation, tous deux sous forme de **lien privé copiable** par l'invitant ; les seuls e-mails envoyés par l'application sont ceux de l'authentification (vérification, réinitialisation). L'envoi automatique d'un e-mail d'invitation est une amélioration ultérieure. Cela corrige la mention « par e-mail » du ticket sur les autorisations.
- Lien : jeton aléatoire long stocké haché, **usage unique**, valable **14 jours**, **révocable** avant usage, régénérable (l'ancien est alors révoqué).
- Invitation de **membre** : liée à une adresse e-mail précise ; le profil qui l'utilise doit avoir vérifié cette adresse, sinon refus. Invitation de **locataire** : liée à un dossier ; un écart d'e-mail n'affiche qu'un avertissement au propriétaire.
- Un lien **inconnu, expiré, utilisé ou révoqué** renvoie le même message « Lien invalide ou expiré » ; tentatives limitées à 10 par heure par IP et par profil connecté.

**Demande et validation**
- La page publique d'inscription crée un compte vide, sans aucune donnée visible. Authentification par **e-mail et mot de passe**, vérification obligatoire de l'e-mail, réinitialisation par lien.
- Utiliser un lien locataire crée une **demande de rattachement** « en attente », avec **case de consentement obligatoire** à la remise dématérialisée (profil, date et heure, version du texte enregistrés). Sans consentement, pas de demande.
- Le propriétaire (administrateur ou gestionnaire) voit l'e-mail du compte et celui du dossier, avec avertissement en cas d'écart, et **valide ou refuse** en un clic. Jamais de rattachement sur la seule base d'un e-mail identique.
- Avant validation, le locataire voit uniquement la liste de ses demandes (en attente, validée, refusée, révoquée, expirée) et le nom de la structure.
- Une demande en attente **expire après 30 jours** ; compteur de demandes en attente dans la navigation et sur le tableau de bord, sans notification envoyée.

**Cardinalités**
- Un dossier est rattaché à **au plus un profil actif** ; un profil peut être rattaché à plusieurs dossiers. En colocation, chaque colocataire a son dossier et son rattachement ; tous voient les quittances du bail commun, jamais le dossier d'un autre. Un nouveau lien pour un dossier déjà rattaché est refusé tant que l'ancien rattachement n'est pas révoqué.
- Le rattachement est lié au **profil**, pas à l'adresse e-mail : un changement d'e-mail de connexion exige une nouvelle vérification, ne casse aucun rattachement et ne modifie pas l'e-mail du dossier.

**Révocation et consentement**
- Aucune révocation automatique à la fin du bail. Le propriétaire peut révoquer à tout moment ; le locataire peut se détacher lui-même. Effet immédiat, tracé dans `audit_logs`, historique des demandes conservé, nouveau lien possible. Purge avec le dossier à l'échéance RGPD (3 ans après clôture).
- Le locataire peut **retirer son consentement** : le dossier reçoit l'indicateur « remise papier demandée » visible du propriétaire, les nouvelles quittances ne lui sont plus mises à disposition en ligne, sans bloquer l'émission du PDF par le propriétaire.
