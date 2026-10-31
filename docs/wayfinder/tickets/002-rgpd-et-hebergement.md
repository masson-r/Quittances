---
title: Obligations RGPD et hébergement des données
type: research
status: closed
assignee: massonr (agent research)
blocked_by: []
---

## Question

Quelles obligations RGPD s'appliquent à une application de gestion locative privée, multi-propriétaires, qui stocke des données sensibles (date de naissance, informations sur les garants, aides au logement) ? Sources primaires : CNIL, texte du RGPD, documentation Supabase et Vercel.

À établir :
- rôle du propriétaire et de l'éditeur (responsable de traitement ou sous-traitant) ;
- base légale et minimisation des données locataires ;
- durées de conservation, et sort d'un dossier locataire après la fin du bail ;
- région Supabase et Vercel à retenir (UE) et transferts hors UE ;
- droits d'accès et d'effacement face à l'obligation de conserver les quittances et pièces comptables ;
- exigences sur les journaux et les sauvegardes.

## Résolution

Recherche menée par sous-agent, détails et sources dans la branche jetable `research/rgpd-et-hebergement` (fichier `docs/research/rgpd-et-hebergement.md`, jamais fusionnée).

- **Rôles** : chaque propriétaire est responsable de traitement (référentiel CNIL gestion locative) ; l'éditeur est sous-traitant pour les données de gestion et responsable pour ses données de compte. Un accord de sous-traitance (art. 28) propriétaire-éditeur est requis.
- **Bases légales** : exécution du contrat et obligation légale ; le consentement ne sert que pour l'e-mail du locataire. Date de naissance facultative et absente des quittances ; garants limités au décret 2015-1437.
- **Conservation** : base active jusqu'à la clôture, puis archive restreinte de 3 ans en gestion directe (5 ans en gestion déléguée), puis purge ou anonymisation.
- **Hébergement** : Supabase `eu-west-3` (Paris) et Vercel `regions: ["cdg1"]` (le défaut de Vercel est `iad1`, États-Unis). Des transferts hors UE subsistent, encadrés par des clauses contractuelles types.
- **Effacement** : quittances et écritures conservées avec accès restreint (art. 17 §3), refus partiel motivé sous un mois.
- **Journaux et sauvegardes** : `audit_logs` par identifiants sans recopier de données personnelles, 6 à 12 mois ; sauvegardes Supabase de 7 à 30 jours, sans Storage.
- **À vérifier** : textes L123-22 et L102 B (connus par le BOFiP seulement), loi du 25 juin 2026 non vérifiée, nécessité de la date de naissance, accord de sous-traitance sur les offres gratuites, rétention des journaux Supabase, analyse d'impact. EUR-Lex et Légifrance étaient inaccessibles : le RGPD est cité via cnil.fr.
