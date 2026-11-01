---
status: proposed
---

# Sauvegardes supplémentaires et test de restauration reportés

Pour le MVP, aucun export personnalisé ni test de restauration n'est mis en place ; la production reste en offre Pro de Supabase pour les sauvegardes natives quotidiennes de 7 jours de la base. Le Storage (PDF et signatures) n'est pas sauvegardé. L'utilisateur a accepté ce risque : l'application ne contient que des données fictives tant que le jalon « sauvegardes et restauration » n'est pas levé.

C'est une dérogation consciente au README §13 et au Lot 6, qui demandent des sauvegardes adaptées et une restauration testée. Condition : ce jalon est revu et tranché, par un ADR de remplacement, avant la première utilisation avec des données réelles (ticket L6-04), et le risque figure au registre (R3).
