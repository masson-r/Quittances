# Domaines

Un dossier par domaine métier. Chacun contient ses schémas Zod (`schemas`), son service (`service`), son accès base (`repository`) et ses contrôles d'autorisation (`permissions`). Les pages et routes de `src/app` appellent les services et ne touchent jamais la base directement.

| Dossier | Contenu |
|---|---|
| `identity` | profils, structures propriétaires, membres, invitations, rattachement des locataires |
| `properties` | biens, codes d'accès, notes de maintenance |
| `leasing` | locataires, baux, conditions de loyer |
| `finance` | échéances, paiements, affectations, apurements, quittances |
| `expenses` | dépenses et catégories |
| `documents` | fichiers du stockage privé, signatures |
| `dashboard` | indicateurs et vues de pilotage |

`src/lib` : utilitaires partagés sans logique métier.
