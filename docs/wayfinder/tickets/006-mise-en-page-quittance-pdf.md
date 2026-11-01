---
title: Mise en page de la quittance et du reçu partiel en PDF
type: prototype
status: closed
assignee: massonr
blocked_by:
  - 001-cadre-legal-quittances.md
---

## Question

À quoi ressemblent la quittance et le reçu de paiement partiel ? Fournir à l'utilisateur un exemple PDF concret à critiquer : mentions obligatoires issues du ticket sur le cadre légal, disposition, vocabulaire, identifiant du document, rendu d'une colocation, distinction visuelle entre quittance et reçu partiel, instantané des informations à l'émission. Le prototype est jetable et ne rejoint pas l'application.

Décisions issues du ticket clos sur les règles financières : date d'émission et date de paiement modifiables à l'émission (figées dans l'instantané) ; détail des dates en cas de règlements multiples à montrer dans le document.

## Prototype (en attente du retour de l'utilisateur)

Trois variantes jetables, chacune avec une quittance de colocation réglée en deux fois et un reçu de paiement partiel, sur la branche `prototype/quittance-pdf` (dossier `prototype-quittance-pdf/`, jamais fusionnée) :
- A, courrier classique avec phrase de déclaration ;
- B, fiche à bandeau avec tampon d'état et grands montants ;
- C, relevé compact avec frise des règlements et jauge.

## Résolution

Décidé par l'utilisateur après examen du prototype : **la variante C (relevé compact) est retenue** pour la quittance et pour le reçu de paiement partiel. Le prototype complet reste sur la branche jetable `prototype/quittance-pdf`.

Éléments de la variante C à reprendre : bande verticale colorée sur le bord (bleue pour la quittance, orange pour le reçu), puce de genre (« QUITTANCE » ou « REÇU — PAS UNE QUITTANCE »), période en grand, trois colonnes bailleur, locataires et logement, frise des règlements avec date, mode et montant, jauge du montant reçu sur le montant de l'échéance (« Soldé le … » ou « Reste dû … »), tableau de décomposition loyer et charges, phrase de déclaration avec le montant en chiffres et en lettres, identifiant unique du document en en-tête, mention de conservation de 3 ans et de gratuité.

Ajouts demandés par l'utilisateur :
- Le propriétaire peut **téléverser une image de signature** (PNG ou JPEG), incluse dans le document à la place de la ligne de signature.
- Le document porte la mention **« signé électroniquement »** avec l'**identifiant du document**.

Points laissés à trancher dans le ticket sur le modèle relationnel (propositions de départ, non validées) : la signature est rattachée à la structure et téléversée par l'administrateur ; l'image utilisée est figée dans l'instantané de chaque quittance ; limites de type et de taille du fichier ; comportement quand aucune signature n'est téléversée. La mention « signé électroniquement » indique une émission par le compte du bailleur et ne constitue pas une signature électronique qualifiée ; la recherche juridique n'a trouvé aucune exigence légale de signature.
