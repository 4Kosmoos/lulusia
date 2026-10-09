# Bot Discord Lulusia

Bot du serveur Discord « Lulusia ». Il lit l'état de la partie Satisfactory via l'API de [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM).

## Fonctionnalités

- [x] `#statut` : un message mis à jour toutes les minutes (joueurs connectés, partie, énergie, batteries, fusibles).
- [x] Pont entre le chat du jeu et `#general` : les messages des joueurs et les messages système du jeu arrivent sur Discord (sauf les arrivées et départs de joueurs : FRM les renvoie cassés, et `/joueurs` suffit), et ceux de `#general` arrivent dans le jeu sous le nom « [Discord] pseudo ».
- [x] Commandes slash, utilisables dans tous les salons, avec suggestions pendant la saisie :

  | Commande | Réponse |
  |---|---|
  | `/stock <objet>` | Quantité dans les conteneurs et le dépôt dimensionnel, production et consommation par minute, bilan, et temps avant épuisement si le bilan est négatif |
  | `/energie` | Chaque réseau électrique : consommation actuelle et max, capacité, marge, batteries, fusibles |
  | `/joueurs` | Joueurs connectés : santé, vitesse, et position par rapport au lieu nommé le plus proche (« à 420 m au nord-est de 🚉 Gare Fer ») |
  | `/ping <lieu> [message]` | Marqueur en jeu sur le HUB, une gare, un marqueur de carte ou un joueur, annoncé dans le chat du jeu |

- [x] Les mêmes commandes dans le chat du jeu : `!stock <objet>`, `!energie`, `!joueurs` et `!aide`, tapées dans Satisfactory ou dans `#general`. Le bot (« Lulusia », en orange) répond en texte simple dans le jeu, et avec la réponse habituelle dans `#general`.
- [x] Une commande slash lancée dans `#general` est aussi recopiée dans le chat du jeu.
- [x] Surveillance dans `#alertes` : serveur de jeu ou FRM qui ne répond plus depuis 5 min, RAM ou disque à 90 % ou plus. Un message quand le problème commence, un quand il cesse.
- [ ] Alertes perso (ex. « fer bas »).

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/index.ts` | Démarrage : connexion à Discord, `#statut`, pont du chat, commandes, surveillance |
| `src/config.ts` | Lecture et vérification du `.env` |
| `src/frm.ts` | Client typé de l'API FRM (lecture, et écriture avec le jeton) |
| `src/status.ts` | Message de `#statut` |
| `src/chat.ts` | Pont avec le chat du jeu, et commandes `!` |
| `src/game-chat.ts` | Écriture dans le chat du jeu : expéditeurs, texte sans emoji, file d'attente |
| `src/monitor.ts` | Surveillance du serveur, de la RAM et du disque |
| `src/power.ts`, `src/format.ts` | Mise en forme commune (électricité, nombres, durées) |
| `src/commands/` | Une commande par fichier, qui renvoie sa réponse pour Discord et pour le jeu, plus `index.ts` (enregistrement, commandes `/` et `!`), `shared.ts` (cache, autocomplétion) et `places.ts` (lieux nommés et positions) |

Les commandes slash sont enregistrées sur le serveur Discord du salon `#statut` à chaque démarrage. Les commandes `!` passent par le pont du chat : elles demandent `CHAT_CHANNEL_ID` et `FRM_TOKEN`.

Les noms des objets sont ceux renvoyés par le serveur de jeu, dans sa langue (en anglais : `!stock iron plate`).

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
