---
status: accepted
---

# PDF généré une seule fois à l'émission, avec empreinte SHA-256

Une quittance ou un reçu est généré une seule fois, à l'émission, stocké dans le bucket privé, et son empreinte SHA-256 est enregistrée dans `receipts` avec un instantané `jsonb` de tout ce que le document affiche. Les téléchargements servent toujours le fichier stocké, jamais une régénération : une modification ultérieure du loyer, de l'adresse ou du profil ne doit pas changer un document émis, et l'empreinte permet de prouver qu'il est intact. Une correction passe par l'annulation puis le remplacement, versions conservées.

Conséquence : les fichiers du bucket ne sont pas reconstructibles à l'identique à partir des données, ce qui rend la perte du Storage plus grave que celle de la base (voir ADR 0007).
