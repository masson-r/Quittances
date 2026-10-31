---
title: Architecture technique, environnements et déploiement
type: grilling
status: open
assignee:
blocked_by:
  - 002-rgpd-et-hebergement.md
  - 004-matrice-autorisations.md
---

## Question

Quelle est l'architecture détaillée du monolithe Next.js ? À trancher avec l'utilisateur : découpage en modules et dossiers (services, accès base, autorisations, documents), frontière entre Server Actions et services, atomicité des écritures financières (fonctions SQL ou transactions), génération des échéances (déclenchement idempotent sans système de tâches complexe), génération des PDF côté serveur, environnements dev, preview et production avec Supabase et Vercel, gestion des secrets, sauvegardes et procédure de restauration, migrations non destructives en production.
