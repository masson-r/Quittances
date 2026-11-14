---
status: accepted
---

# Conservation des données financières et des quittances sans purge automatique

L'application ne purge jamais les paiements, échéances, dépenses, apurements ni quittances, et ne supprime aucune ligne financière (annulation avec motif seulement). Seuls deux mécanismes réduisent des données : l'anonymisation manuelle d'un dossier locataire par l'administrateur, possible trois ans après la fin du dernier bail et après l'apurement final (`anonymize_tenant`), et la purge du journal d'audit au-delà de trois ans. Les lignes financières, les baux et les quittances (dont l'instantané nomme encore les personnes) survivent à l'anonymisation, avec accès restreint aux membres de la structure.

Décision de l'utilisateur (14 novembre 2026, jalon L6-04) : la durée de conservation comptable côté bailleur n'impose aucun changement de code, puisqu'il n'existe pas de purge automatique ; l'opérateur ne supprime ni ne purge aucune ligne financière avant d'avoir vérifié la durée applicable à la structure concernée (régime fiscal, forme juridique) et ne la raccourcit jamais en dessous de la prescription de trois ans des actions liées au bail.

Conséquence : si une durée de purge est un jour exigée, elle fera l'objet d'une fonction SQL et d'un ADR dédiés. Point de vigilance : la durée précise applicable à chaque structure reste à confirmer par l'utilisateur auprès de son comptable.
