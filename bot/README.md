# Bot Discord Lulusia

Bot du serveur Discord « Lulusia ». Il lit l'état de la partie Satisfactory via l'API de [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM).

## Fonctionnalités

- [x] `#statut` : un message mis à jour toutes les minutes (joueurs connectés, partie, énergie, batteries, fusibles).
- [x] Pont entre le chat du jeu et `#chat-jeu` : les messages des joueurs arrivent sur Discord, et ceux de `#chat-jeu` arrivent dans le jeu sous le nom « [Discord] pseudo ».
- [ ] Commandes (`/stock`, `/energie`, `/joueurs`, `/ping`…).
- [ ] Alertes perso (ex. « fer bas »).

## Lancer en local

Prérequis : Node.js 24 ou plus. Le TypeScript est exécuté directement par Node (suppression des types), sans étape de build.

```bash
cd bot
npm install
cp .env.example .env   # puis remplir .env (jamais commité)
npm run typecheck
npm run dev            # relance automatique à chaque modification
```

En local, `FRM_URL` pointe vers le serveur via Tailscale. Un seul bot à la fois doit tourner avec le même jeton, sinon ils se disputent le message de `#statut`.

## Production

Le bot tourne sur le VPS dans un conteneur Docker (`Dockerfile`, `docker-compose.yml`), sans aucun port ouvert. Le `.env` de production n'existe que sur le serveur, avec `FRM_URL=http://host.docker.internal:8080`.

```bash
sudo docker compose up -d --build     # construire et (re)lancer
sudo docker compose logs -f --tail 20 # suivre les logs
```

Un seul bot à la fois avec le même jeton : arrêter le bot de production (`sudo docker compose stop`) avant de lancer `npm run dev` en local, puis le relancer après.
