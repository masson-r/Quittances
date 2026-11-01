---
status: accepted
---

# `entity_id` sur toutes les tables de gestion et clés étrangères composites

Chaque table de gestion porte l'identifiant de la structure propriétaire, et les clés étrangères entre elles sont composites, par exemple `(entity_id, lease_id)` vers `leases(entity_id, id)`. Cela rend impossible en base un lien entre deux structures (une affectation, une quittance ou un bail croisant deux périmètres) et réduit la RLS à un contrôle direct sur `entity_id`, sans jointure.

Alternative écartée : des clés étrangères simples avec des contrôles dans les fonctions. Elle laisse la porte ouverte à un lien inter-structures dès qu'un chemin d'écriture oublie le contrôle. Coût accepté : une colonne redondante et des clés plus larges.
