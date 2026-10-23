# Bot Discord Lulusia

Bot du serveur Discord « Lulusia ». Il lit l'état de la partie Satisfactory via l'API de [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM).

Le bot parle anglais (commandes, réponses, messages et logs), comme le jeu et les noms d'objets renvoyés par le serveur. Son code est commenté en anglais ; la documentation du repo reste en français.

## Fonctionnalités

- [x] `#statut` : un message mis à jour toutes les minutes (joueurs connectés, partie, énergie, batteries, fusibles).
- [x] Pont entre le chat du jeu et `#general` : les messages des joueurs et les messages système du jeu arrivent sur Discord (sauf les arrivées et départs de joueurs : FRM les renvoie cassés, et `/players` suffit), et ceux de `#general` arrivent dans le jeu sous le nom « [Discord] pseudo ».
- [x] Commandes slash, utilisables dans tous les salons, avec suggestions pendant la saisie :

  | Commande | Réponse |
  |---|---|
  | `/stock <item>` | Quantité dans les conteneurs et le dépôt dimensionnel, production et consommation par minute, bilan, et temps avant épuisement si le bilan est négatif |
  | `/power` | Chaque réseau électrique : consommation actuelle et max, capacité, marge, batteries, fusibles |
  | `/players` | Joueurs connectés : santé, vitesse, et position par rapport au lieu nommé le plus proche (« 420 m north-east of 🚉 Iron Station ») |
  | `/ping <place> [message]` | Marqueur en jeu sur le HUB, une gare, un marqueur de carte ou un joueur, annoncé dans le chat du jeu |
  | `/alert stock`, `deficit`, `list`, `remove` | Alertes perso (voir plus bas) |
  | `/switch list`, `on`, `off` | Interrupteurs électriques de l'usine (voir plus bas) |
  | `/machines status`, `pause`, `resume` | Toutes les machines qui fabriquent un objet (voir plus bas) |

- [x] Les mêmes commandes dans le chat du jeu : `!stock <item>`, `!power`, `!players`, `!alert …`, `!alerts`, `!switch …`, `!switches`, `!machines …` et `!help`, tapées dans Satisfactory ou dans `#general`. Le bot (« Lulusia », en orange) répond en texte simple dans le jeu, et avec la réponse habituelle dans `#general`.
- [x] Une commande slash lancée dans `#general` est aussi recopiée dans le chat du jeu.
- [x] Surveillance dans `#alertes` : serveur de jeu ou FRM qui ne répond plus depuis 5 min, RAM ou disque à 90 % ou plus. Un message quand le problème commence, un quand il cesse.
- [x] Signal de vie vers Healthchecks.io chaque minute : si le VPS ou le bot tombe, Healthchecks.io prévient dans `#alertes`.
- [x] Alertes perso, dans `#alertes` et dans le chat du jeu, avec à chaque fois la production et la consommation de l'objet :
  - **stock bas** : `/alert stock item:Iron Plate below:1000`, ou `!alert stock iron plate 1000` en jeu. Alerte après 2 min sous le seuil, fin d'alerte à 10 % au-dessus ;
  - **bilan négatif** : `/alert deficit item:Iron Ingot`, ou `!alert deficit iron ingot`. Alerte quand l'objet est consommé plus vite que produit pendant 10 min, fin d'alerte dès que le bilan est rétabli ;
  - `/alert list` (`!alerts`) et `/alert remove` (`!alert remove 2`). Une seule alerte de chaque type par objet : en recréer une met à jour son seuil.
- [x] Pilotage de l'usine, sans confirmation. Chaque action est annoncée dans le chat du jeu avec le nom de son auteur, quel que soit le salon où elle est lancée, et se défait avec la commande inverse :
  - **interrupteurs électriques** : `/switch off name:Iron Factory`, ou `!switch iron factory off` en jeu (`on` pour rallumer, `!switches` pour la liste avec l'état de chacun). Le nom est celui donné à l'interrupteur en jeu, et les interrupteurs qui portent le même nom sont pilotés ensemble. Les interrupteurs sans nom apparaissent dans la liste et dans les suggestions de Discord, repérés par le lieu nommé le plus proche ; pour les piloter depuis le jeu, leur donner un nom ;
  - **machines par objet fabriqué** : `/machines pause item:Iron Plate`, ou `!machines pause iron plate` en jeu (`resume` pour repartir, `!machines iron plate` pour voir combien tournent). Une machine compte pour le produit principal de sa recette. Sont concernées les machines de fabrication (fonderies, constructeurs, raffineries…), pas les extracteurs ni les générateurs. `resume` relance toutes les machines en pause de cet objet, y compris celles mises en pause à la main.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/index.ts` | Démarrage : connexion à Discord, `#statut`, pont du chat, commandes, surveillance |
| `src/config.ts` | Lecture et vérification du `.env` |
| `src/frm.ts` | Client FRM du bot, avec le jeton du `.env` (lecture, et écriture : chat, marqueurs, interrupteurs, machines). Le client lui-même est dans [`lib/`](../lib/) |
| `src/status.ts` | Message de `#statut` |
| `src/chat.ts` | Pont avec le chat du jeu, et commandes `!` |
| `src/game-chat.ts` | Écriture dans le chat du jeu : expéditeurs, texte sans emoji, file d'attente |
| `src/monitor.ts` | Surveillance du serveur, de la RAM et du disque |
| `src/alerts.ts` | Alertes perso : enregistrement des règles (`data/alerts.json`) et vérification chaque minute |
| `src/heartbeat.ts` | Signal de vie pour Healthchecks.io |
| `src/circuits.ts` | Texte des réseaux électriques, commun à `#statut` et à `/power` |
| `src/commands/` | Une commande par fichier (`stock.ts`, `power.ts`, `players.ts`, `ping.ts`, `alert.ts`, `switch.ts`, `machines.ts`), qui renvoie sa réponse pour Discord et pour le jeu, plus `index.ts` (enregistrement, commandes `/` et `!`), `shared.ts` (forme d'une commande, autocomplétion), `inventory.ts` (stocks et rythmes par objet, en texte) et `places.ts` (lieux nommés et positions) |

Les commandes slash sont enregistrées sur le serveur Discord du salon `#statut` à chaque démarrage. Les commandes `!` passent par le pont du chat : elles demandent `CHAT_CHANNEL_ID` et `FRM_TOKEN`. Les commandes slash qui agissent sur la partie (`/ping`, `/switch on` et `off`, `/machines pause` et `resume`) demandent `FRM_TOKEN`.

Les noms des objets sont ceux renvoyés par le serveur de jeu, en anglais (`!stock iron plate`).

## Lancer en local

Prérequis : Node.js 24 ou plus. Le TypeScript est exécuté directement par Node (suppression des types), sans étape de build.

Le bot est un des workspaces npm du repo : les dépendances s'installent depuis la racine, pour le bot et pour le code partagé de [`lib/`](../lib/) (client FRM, calculs de stocks et d'énergie, mise en forme des nombres).

```bash
npm install            # à la racine du repo
cd bot
cp .env.example .env   # puis remplir .env (jamais commité)
npm run typecheck
npm run dev            # relance automatique à chaque modification, y compris de lib/
```

En local, `FRM_URL` pointe vers le serveur via Tailscale. Un seul bot à la fois doit tourner avec le même jeton, sinon ils se disputent le message de `#statut`.

## Production

Le bot tourne sur le VPS dans un conteneur Docker (`Dockerfile`, `docker-compose.yml`), sans aucun port ouvert. L'image est construite depuis la racine du repo, pour y inclure `lib/` ; `Dockerfile.dockerignore` limite ce qui est envoyé à Docker (jamais le `.env`). Le `.env` de production n'existe que sur le serveur, avec `FRM_URL=http://host.docker.internal:8080`.

```bash
sudo docker compose up -d --build     # construire et (re)lancer
sudo docker compose logs -f --tail 20 # suivre les logs
```

**Déploiement** : automatique à chaque push sur `main` qui touche `bot/` ou `lib/`. GitHub Actions vérifie le code, puis le déploie sur le VPS à travers Tailscale (voir [Exploitation](../docs/exploitation.md#déploiement-automatique-du-bot)). À la main, sur le serveur : `lulusia-deploy-bot`.

Un seul bot à la fois avec le même jeton : arrêter le bot de production (`sudo docker compose stop`) avant de lancer `npm run dev` en local, puis le relancer après. Pendant ce temps, ne pas pousser de changement dans `bot/` ou `lib/` : le déploiement automatique relancerait le bot du serveur.
