---
status: accepted
supersedes: 0005-sauvegardes-supplementaires-reportees.md
---

# Sauvegardes supplémentaires du Storage : risque accepté

Le jalon « sauvegardes et restauration » de l'ADR 0005 est tranché : **le risque est accepté**. La production reste en offre Pro de Supabase (sauvegardes natives quotidiennes de la base, 7 jours). Le contenu du Storage (PDF des quittances et reçus, justificatifs de dépenses) n'est pas sauvegardé et aucun test de restauration n'est prévu pour l'instant. Les images de signature sont en base, donc sauvegardées.

Décision de l'utilisateur (14 novembre 2026, jalon L6-04), prise en connaissance de la conséquence : un fichier perdu ne se régénère pas à l'identique (ADR 0004). Atténuation : l'instantané `jsonb` de chaque document reste en base, et le propriétaire peut annuler puis remplacer un document perdu, ce qui produit un nouveau document et non une copie de l'ancien.

À revoir : au premier incident de perte de fichier, ou dès que l'utilisateur le décide. Une option simple serait alors un export périodique du Storage par un script de l'opérateur. Le risque R3 du registre devient « accepté » (et non plus « jalon à lever avant données réelles »).
