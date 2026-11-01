---
status: proposed
---

# Opérations financières multi-lignes en fonctions SQL

Toute opération qui écrit plusieurs lignes (saisie d'un paiement avec ses affectations, annulation, déplacement d'affectation, recalcul d'échéance, émission d'une quittance, saisie d'un apurement) est une fonction SQL versionnée en migration, exécutée en une transaction sous les droits de l'utilisateur, donc sous la RLS. Le client Supabase n'offre pas de transaction sur plusieurs requêtes, et un verrouillage (`SELECT … FOR UPDATE`) plus des triggers de contrainte en dernier recours garantissent les invariants même sous concurrence.

Alternative écartée : des transactions dans le code applicatif sur une connexion PostgreSQL directe. Elle disperse les règles financières entre code et base et contourne les garanties de la RLS. Coût accepté : de la logique métier en SQL, couverte par des tests d'intégration.
