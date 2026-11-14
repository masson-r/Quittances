---
status: accepted
---

# Conservation des données financières et des quittances sans purge automatique

L'application ne purge jamais les paiements, échéances, dépenses, apurements ni quittances, et ne supprime aucune ligne financière (annulation avec motif seulement). Seuls deux mécanismes réduisent des données : l'anonymisation manuelle d'un dossier locataire par l'administrateur, possible trois ans après la fin du dernier bail et après l'apurement final (`anonymize_tenant`), et la purge du journal d'audit au-delà de trois ans. Les lignes financières, les baux et les quittances (dont l'instantané nomme encore les personnes) survivent à l'anonymisation, avec accès restreint aux membres de la structure.

Décision de l'utilisateur (14 novembre 2026, jalon L6-04) : **les données financières et les quittances sont conservées 25 ans** (à compter de la fin du bail concerné). Cette durée n'impose aucun changement de code, puisqu'il n'existe pas de purge automatique : l'opérateur ne supprime ni ne purge aucune ligne financière ni aucun document avant l'échéance de 25 ans.

Conséquences :
- Au terme des 25 ans, une purge éventuelle sera faite par l'opérateur ; si elle doit être automatisée, elle fera l'objet d'une fonction SQL et d'un ADR dédiés.
- Point de vigilance RGPD : les instantanés des quittances conservent le nom des locataires pendant toute cette durée (accès restreint aux membres de la structure). L'anonymisation du dossier à 3 ans efface l'identité du dossier, pas celle figée dans les documents émis. Le choix de 25 ans est celui de l'utilisateur ; sa justification (obligation légale ou intérêt légitime documenté) est à porter dans le registre de traitement et dans l'accord de sous-traitance.
