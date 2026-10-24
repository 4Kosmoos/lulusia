# Architecture

Ce qui tourne où, comment ça communique, et comment c'est protégé.

## Vue d'ensemble

```
┌──────────────────── VPS « lulusia » (Ubuntu 24.04) ────────────────────┐
│  Serveur Satisfactory (SteamCMD, service systemd, utilisateur steam)   │
│   └─ FRM : API JSON sur le port 8080 (bloqué par ufw)                  │
│  Docker                                                                │
│   ├─ Stack Grafana : Grafana, Prometheus, Postgres, collecteurs FRM    │
│   ├─ Bot Discord (TypeScript)                                          │
│   └─ Serveur MCP (TypeScript) : l'usine en lecture seule pour Claude,  │
│      avec sa machine Tailscale « lulusia-mcp » (Funnel sur son 443)    │
│  Entretien (systemd) : sauvegardes toutes les 6 h,                     │
│                        redémarrage complet quotidien                   │
│  Tailscale : accès privé, Grafana publié en HTTPS (tailscale serve)    │
└────────────────────────────────────────────────────────────────────────┘
      ▲ jeu (7777, 8888)      ▲ Tailscale (privé)     ▲ Funnel (443)     │
  Les deux joueurs (Steam)    Grafana (navigateur)    Claude (cloud)     ▼
                                                                Discord (bot, webhooks FRM)
```

Sur le serveur, tout se range en trois familles :

1. **Le jeu** : le serveur dédié, ses mods et ses parties, sous l'utilisateur `steam`.
2. **Nos outils Docker** : la stack Grafana, le bot Discord et le serveur MCP, sous l'utilisateur `ubuntu`.
3. **L'entretien automatique** : les timers systemd (sauvegardes, redémarrage complet, watchdog de FRM).

La commande `lulusia-status` affiche l'état des trois d'un coup (voir [Exploitation](exploitation.md)). Le VPS est réglé en UTC.

## Carte du serveur

| Quoi | Où | Accès |
|---|---|---|
| Serveur de jeu et mods | `/home/steam/SatisfactoryDedicatedServer` | privé : `sudo -u steam ls …` |
| Mods installés | `…/FactoryGame/Mods` et son sous-dossier `GameFeatures`, fichier de verrouillage `lulusia-lock.json` | privé |
| Parties | `/home/steam/.config/Epic/FactoryGame/Saved/SaveGames/server` | privé |
| Profil des mods (ficsit-cli) | `/home/steam/.local/share/ficsit` | privé |
| Réglages du serveur et de FRM | `/home/steam/SatisfactoryDedicatedServer/FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini` | privé |
| Stack Grafana (Docker) | `/home/ubuntu/satisfactory-monitoring` | `ubuntu` |
| Ce repo, dont le bot Discord et le serveur MCP | `/home/ubuntu/lulusia` (bot : `…/bot`, serveur MCP : `…/mcp`) | `ubuntu` |
| Identité de la machine Tailscale `lulusia-mcp` | volume Docker `lulusia-mcp_tailscale-state` | root (Docker) |
| Archives des parties | `/var/backups/lulusia` | root : `sudo ls …` |
| Scripts maison | `/usr/local/bin/lulusia-backup`, `/usr/local/bin/lulusia-status`, `/usr/local/bin/lulusia-watchdog`, `/usr/local/bin/lulusia-deploy` | |
| Services et timers systemd | `/etc/systemd/system/satisfactory.service`, `satisfactory-full-restart.{service,timer}`, `lulusia-backup.{service,timer}`, `lulusia-watchdog.{service,timer}` | |

Les originaux des scripts, services et configs installés à la main sont versionnés dans [`ops/`](../ops/).

**Pourquoi plusieurs `docker-compose.yml`** : la stack Grafana (projet communautaire, mis à jour par `git pull` de son propre repo), le bot et le serveur MCP (notre code) sont trois applications indépendantes. Chacune a son dossier et son compose, pour être mise à jour ou redémarrée sans toucher aux autres.

## Réseau

### Ports ouverts vers Internet

| Port | Protocole | Usage |
|---|---|---|
| 22 | TCP | SSH, authentification par clé uniquement |
| 7777 | TCP + UDP | Jeu |
| 8888 | TCP | Messagerie fiable du jeu, obligatoire depuis la 1.1 |

Rien d'autre : FRM et Grafana **ne sont pas exposés publiquement**. Seul le serveur MCP est public, publié par [Tailscale Funnel](#accès-public-du-serveur-mcp--tailscale-funnel) sans ouvrir de port sur le VPS.

Règles ufw en plus des ports publics :

| Règle | Pourquoi |
|---|---|
| `allow in on tailscale0` | Tout ce qui arrive par Tailscale est autorisé : nos appareils, et GitHub Actions, que la politique Tailscale limite au port 22 |
| `allow from 172.16.0.0/12 to any port 8080 proto tcp` | Les conteneurs Docker lisent FRM sur la machine hôte |

**Principe pour Docker** : les règles de Docker passent avant celles d'ufw, donc aucun port de conteneur n'est publié autrement que sur `127.0.0.1`. L'accès à Grafana passe par Tailscale, celui du serveur MCP par Tailscale Funnel. Les conteneurs joignent FRM sur l'hôte par `host.docker.internal` (option `extra_hosts: host-gateway`).

Aucune règle **sortante** n'est nécessaire : le serveur peut toujours télécharger le jeu et les mods, appeler Discord et GitHub. Partager un dashboard est donc une question de règles **entrantes**.

### Accès privé : Tailscale

- Réseau privé chiffré entre le VPS (nom `lulusia` sur le réseau Tailscale) et nos PC. Gratuit pour un usage perso.
- L'**expiration de clé est désactivée** pour le VPS (console Tailscale, Machines), sinon il sortirait du réseau au bout de 180 jours.
- **Grafana** écoute sur `127.0.0.1:3000` et `tailscale serve` le publie en HTTPS sur `https://lulusia.<nom-du-tailnet>.ts.net/`, uniquement pour les appareils du réseau Tailscale (pas Funnel, donc rien de public).
- **GitHub Actions** rejoint le réseau le temps d'un déploiement (machine temporaire `tag:ci`). La politique Tailscale ne lui ouvre que le port 22 du VPS (voir [Exploitation](exploitation.md#déploiement-automatique)).
- **Le deuxième joueur** a son propre compte Tailscale : la machine `lulusia` lui est **partagée** (console Tailscale, Machines, `…`, Share). Il ne voit que cette machine, et elle ne peut pas se connecter à ses appareils. Il a son propre compte Grafana, jamais le compte admin.
- En développement, le PC joint FRM directement : `http://lulusia.<nom-du-tailnet>.ts.net:8080`.
- Plus tard, pour une vitrine publique : Caddy avec HTTPS et un nom de domaine (ports 80 et 443), ou Cloudflare Tunnel (aucun port à ouvrir).

### Accès public du serveur MCP : Tailscale Funnel

- Claude appelle les connecteurs depuis les serveurs d'Anthropic, pas depuis l'appareil de l'utilisateur : le serveur MCP doit avoir une adresse HTTPS publique, le réseau privé ne suffit pas. Et Claude ne contacte un serveur MCP que sur le port HTTPS standard, 443 (essayé en 8443 : aucune requête n'arrive).
- **Une machine Tailscale dédiée** : `lulusia-mcp`, un conteneur `tailscale/tailscale` à côté du serveur MCP, dans le même compose. C'est une machine de plus dans notre tailnet, comme un nouvel appareil, avec son nom, son adresse et son certificat HTTPS.
- **Funnel** publie son port 443 sur Internet, `https://lulusia-mcp.<nom-du-tailnet>.ts.net/`, vers le conteneur du serveur MCP. Les relais de Tailscale reçoivent les connexions et les transmettent à la machine par le tunnel qu'elle ouvre elle-même : aucun port ouvert dans ufw ni chez OVH. Le certificat HTTPS est géré par Tailscale.
- **Pourquoi pas le VPS lui-même** : son 443 sert à Grafana, en privé, et Funnel s'active port par port. Avec une machine dédiée, Grafana reste privé et le VPS ne publie rien sur Internet.
- **Politique Tailscale** : `tag:mcp` est le seul à avoir l'attribut `funnel`, et aucune règle ne part de `tag:mcp` : la machine ne peut joindre aucune autre machine du tailnet. Nos appareils, eux, peuvent la joindre.
- **Ce qui protège le serveur** : connexion OAuth par GitHub via WorkOS AuthKit, jetons vérifiés, liste des comptes autorisés, lecture seule (détail dans le [README du serveur MCP](../mcp/README.md#sécurité)).
- Alternative sans Tailscale, pour la version communautaire : un nom de domaine et Caddy, avec le port 443 ouvert seulement aux adresses des connecteurs Claude (voir la [feuille de route](feuille-de-route.md)).

## Sécurité

| Sujet | Mise en place |
|---|---|
| SSH | Utilisateur `ubuntu` (par défaut sur les images Ubuntu d'OVH). Connexion par clé uniquement, phrase de passe sur la clé. Mots de passe et connexion root interdits (`/etc/ssh/sshd_config.d/00-hardening.conf`, copie dans [`ops/ssh/`](../ops/ssh/)). Sur le PC, un alias `ssh ficsit` dans `~/.ssh/config` |
| Pare-feu | `ufw` : 22, 7777, 8888 publics, plus les deux règles ci-dessus. À doubler par le pare-feu réseau d'OVH s'il est disponible |
| Tentatives de connexion | fail2ban bannit les adresses qui insistent (en plus de l'authentification par clé) |
| Mises à jour | `unattended-upgrades` : correctifs de sécurité Ubuntu automatiques. Le jeu, lui, n'est jamais mis à jour automatiquement, à cause des mods |
| Mémoire | swap de 4 Go (`/swapfile`, `vm.swappiness=10`) comme filet de sécurité |
| Utilisateurs | le jeu tourne sous `steam`, sans droits d'administration. Son dossier personnel est privé |
| FRM | les endpoints d'écriture demandent le jeton FRM (en-tête `X-FRM-Authorization`). Le port 8080 n'est pas exposé |
| Conteneurs | Bot et serveur MCP (avec sa machine Tailscale) : système de fichiers en lecture seule, sauf `/tmp` et leurs volumes, aucune capacité Linux, pas d'élévation de privilèges, mémoire et nombre de processus bornés. La stack Grafana garde la configuration de son projet |
| Serveur MCP | Lecture seule (client FRM sans écriture ni jeton). Connexion par GitHub via WorkOS AuthKit (OAuth), jetons vérifiés (signature, émetteur, audience, expiration), liste des comptes autorisés. Publié par sa propre machine Tailscale, sans accès au reste du tailnet. Conteneurs durcis ([détail](../mcp/README.md#sécurité)) |
| Déploiement | GitHub Actions passe par Tailscale, authentifié par fédération d'identité (aucun secret Tailscale stocké chez GitHub), avec une clé SSH dédiée qui ne peut lancer que `lulusia-deploy`, et seulement depuis une adresse Tailscale. Actions épinglées sur un commit précis |
| Secrets | jetons (Discord, FRM), webhooks et IP uniquement dans des `.env` hors du repo et dans le gestionnaire de mots de passe. La clé SSH personnelle ne quitte jamais le PC ; seule la clé de déploiement, bridée, est dans les secrets GitHub. Le secret de l'app OAuth GitHub n'existe que chez WorkOS |


## Hébergement : OVH VPS-3

| Caractéristique | VPS-3 (actuel) | VPS-4 (si besoin) |
|---|---|---|
| Processeur | 6 vCores | 8 vCores |
| RAM | 12 Go | 24 Go |
| Disque | 100 Go NVMe | 200 Go NVMe |
| Bande passante | 2 Gbit/s | 3 Gbit/s |
| Prix affiché | 10,40 € HT, soit 12,48 € TTC par mois | 19,96 € HT, soit 23,95 € TTC par mois |

Inclus dans les deux : sauvegarde quotidienne du VPS, IPv4, IPv6, anti-DDoS, trafic illimité.

- **Pourquoi le VPS-3 d'abord** : la montée en gamme se fait en un clic sans migration, alors que la descente oblige à prendre un nouveau VPS. 12 Go suffisent en début de partie ; ça risque d'être juste en fin de partie avec SF+ et la stack Docker.
- **Datacenter classique** (Gravelines, Roubaix ou Strasbourg), pas une « Local Zone » : les Local Zones ne supportent pas Docker.
- **Processeur exact non communiqué** par OVH : surveiller les performances.
- **Pas de « Game Panel » OVH** : le serveur est installé à la main.
- **Réinstaller l'OS** : espace client OVH, ligne « OS / Distribution », bouton `…`, « Réinstaller mon VPS » (efface tout).

### Passer au VPS-4

**Quand** : si la RAM dépasse régulièrement **80 %**, ou si le serveur rame.

**Ce qui est conservé** : les données, l'adresse IP, les sauvegardes et les snapshots. Rien à réinstaller.

**Le seul point délicat, le disque** : l'espace passe de 100 à 200 Go, mais la partition n'est **pas** agrandie automatiquement selon la doc OVH. L'agrandir à la main comporte un risque de perte de données, et 100 Go suffisent : étape **facultative**. Si on la fait un jour : sauvegarde complète d'abord, et vérifier avec `df -h` si Ubuntu ne l'a pas déjà fait au redémarrage.

**Procédure** :

1. Choisir un moment hors session de jeu.
2. Sauvegarder la partie (`sudo systemctl start lulusia-backup.service`) et faire un snapshot du VPS.
3. Lancer la montée en gamme depuis l'espace client OVH (vérifier l'effet sur un éventuel engagement).
4. Après le redémarrage, vérifier avec `lulusia-status` que tout est reparti tout seul.
5. Contrôler avec `free -h` que la RAM est bien de 24 Go.

**Limite** : possible seulement s'il reste des ressources dans le datacenter du VPS. Sinon, il faut un nouveau VPS et une migration.

### Plan de repli

Si les performances ne suivent pas : mettre le serveur de jeu chez un hébergeur spécialisé, et garder un petit VPS pour les outils (Docker, bot, Grafana).

## Discord

Serveur Discord « Lulusia », pour les deux joueurs.

| Salon | Contenu | État |
|---|---|---|
| `#statut` | Un message du bot mis à jour toutes les minutes : joueurs, partie, électricité, batteries | ✅ |
| `#general` | Pont avec le chat du jeu, dans les deux sens. Les commandes `!` (`!stock`, `!machines`, `!help`…) y marchent comme en jeu, et les commandes slash lancées ici sont recopiées dans le jeu | ✅ |
| `#alertes` | Webhook FRM : fusible, batteries (50, 25, 10 %), recherches, jalons, trains. Surveillance du bot : serveur qui ne répond plus, RAM, disque. Healthchecks.io : VPS ou bot en panne. Alertes perso du bot (stock bas, bilan négatif), aussi annoncées dans le jeu | ✅ |
| `#dev` | Commits GitHub (webhook Discord avec `/github` ajouté à la fin de l'URL) | ✅ |

- **Bot** : application Discord « Lulusia » **privée** (lien d'installation : Aucun), ajoutée au serveur avec le minimum de permissions : voir les salons, envoyer des messages, intégrer des liens, voir les anciens messages, ajouter des réactions. L'intent privilégié *Message Content* est activé (lecture de `#general`). Le bot enregistre ses commandes slash (`/stock`, `/power`, `/players`, `/ping`, `/alert`, `/switch`, `/machines`) sur le serveur à chaque démarrage (la portée `applications.commands` est incluse avec la portée `bot`). Elles marchent dans tous les salons : à deux joueurs, pas besoin d'un salon dédié.
- **Webhooks** : leurs URL sont des secrets (quiconque les a peut écrire dans le salon). Si une URL fuite, supprimer le webhook et en recréer un.

## Claude (serveur MCP)

Le [serveur MCP](../mcp/) permet à Claude de lire l'usine en direct, pour les deux joueurs.

| Élément | Mise en place |
|---|---|
| Serveur d'autorisation | WorkOS AuthKit, projet « lulusia », environnement Production. Connexion par GitHub uniquement, inscriptions fermées une fois nos comptes créés |
| App OAuth GitHub | « Lulusia », scope `user:email` (l'adresse e-mail, rien d'autre). Son secret n'existe que chez WorkOS |
| Machine Tailscale | `lulusia-mcp`, taguée `tag:mcp`, dans un conteneur à côté du serveur MCP. Seule machine autorisée à utiliser Funnel, sans accès au reste du tailnet |
| Connecteur Claude | Ajouté par chaque joueur sur son propre compte Claude, avec l'adresse `https://lulusia-mcp.<nom-du-tailnet>.ts.net/mcp`. Il marche sur le web, l'application de bureau et l'application mobile |
| Comptes autorisés | Les deux joueurs, par leur identifiant WorkOS (`ALLOWED_USERS` dans le `.env` du serveur MCP) |

Mise en place et ajout d'un compte : voir [Exploitation](exploitation.md#serveur-mcp-claude).
