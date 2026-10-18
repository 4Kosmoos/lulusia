# Feuille de route

Ce qui est fait, ce qui reste, et les idées pour plus tard.

## Étapes

| # | Étape | État |
|---|---|---|
| 0 | Définir le projet : mods, réglages de la partie, architecture | ✅ |
| 1 | VPS OVH VPS-3 sous Ubuntu 24.04, connexion SSH par clé | ✅ |
| 2 | Sécurisation : connexion par clé uniquement, `ufw`, fail2ban, mises à jour automatiques, swap | ✅ |
| 3 | Serveur Satisfactory : utilisateur `steam`, SteamCMD, service systemd, serveur revendiqué | ✅ |
| 4 | Mods : SMM sur les deux PC, ficsit-cli sur le serveur (22 mods) | ✅ |
| 5 | Partie créée en solo (tutoriel), envoyée sur le serveur, FRM configuré | ✅ |
| 6 | Tailscale, Docker, stack Grafana publiée en HTTPS sur le réseau privé | ✅ |
| 7 | Discord : serveur et salons, alertes FRM, bot (`#statut`, pont avec le chat, commandes) | ✅ |
| 8 | Sauvegardes et surveillance | ✅ |
| 9 | Repo git publié, le VPS se met à jour par `git pull`, fichiers du serveur identiques à `ops/` | ✅ |

## Bot Discord

- [x] **Commandes** `/stock`, `/power`, `/players`, `/ping`, `/alert`, `/switch`, `/machines`, dans tous les salons (détail dans le [README du bot](../bot/README.md)).
- [x] **Commandes depuis le chat du jeu** : les mêmes avec `!` (`!stock`, `!switch`, `!machines`, `!help`…), avec réponse dans le jeu et dans `#general`.
- [x] **Piloter l'usine** sans confirmation, chaque action annoncée dans le chat du jeu : interrupteurs électriques par leur nom (`setSwitches` de FRM), pause et relance de toutes les machines qui fabriquent un objet (`setEnabled`).
- [x] **Alertes perso** dans `#alertes` et dans le chat du jeu : stock bas et bilan négatif, gérées par `/alert` ou `!alert` (détail dans le [README du bot](../bot/README.md)).
- [x] **Bot en anglais** (octobre 2026) : commandes, réponses et logs, comme le jeu et les noms d'objets renvoyés par le serveur. La doc reste en français.
- [ ] Si les alertes FRM deviennent trop bruyantes : les faire passer par le bot pour les trier par salon.
- [x] **Déploiement automatique du bot** à chaque push : vérification puis déploiement par GitHub Actions, connexion au VPS par Tailscale ([détail](exploitation.md#déploiement-automatique-du-bot)).

## Sauvegardes et surveillance

- [x] Archives locales toutes les 6 h, gardées 14 jours.
- [x] Restauration testée en octobre 2026 : la dernière archive s'ouvre en solo avec l'usine et les mods ([procédure](exploitation.md#tester-une-archive-sans-toucher-au-serveur)).
- Décidé : **pas de copie automatique hors du serveur** pour l'instant. Les archives locales couvrent les erreurs et les sauvegardes corrompues, la sauvegarde quotidienne d'OVH couvre une panne du VPS. Pour le risque restant (perdre les deux ensemble), [copie manuelle sur le PC](exploitation.md#copier-une-archive-sur-le-pc) de temps en temps. Options si on change d'avis : une tâche planifiée Windows qui récupère l'archive par Tailscale avec une clé SSH en lecture seule (PC allumé nécessaire), ou `rclone` chiffré vers un compte cloud dédié au projet.
- [x] **Alertes Discord du serveur** par le bot dans `#alertes` : serveur de jeu ou FRM qui ne répond plus, RAM et disque presque pleins ([détail](exploitation.md#bot-discord)).
- [x] **Surveillance externe** : signal de vie du bot vers Healthchecks.io chaque minute, alerte dans `#alertes` s'il cesse (VPS ou bot en panne).
- [x] **Redémarrage automatique quand FRM tombe** : `lulusia-watchdog`, un timer systemd côté serveur (le bot, dans Docker, n'a pas accès à systemd). Redémarrage après 5 à 10 min de panne, 3 fois par jour au maximum ([détail](exploitation.md#redémarrage-automatique-quand-frm-tombe)). Décidé : il redémarre même si quelqu'un joue. Compter les joueurs demanderait un jeton d'administration du serveur, pour un cas rare (un « Charger sauv. »).

## Grafana

- [ ] Vérifier que les dashboards affichent bien les usines récentes depuis la réparation de FRM.
- [ ] Prendre en main les dashboards (variables serveur et session, filtres par objet ou par zone).
- Décidé : **pas d'alertes de la stack vers Discord pour l'instant**. Elle n'envoie que fusible grillé et batterie vide, que FRM envoie déjà, et FRM les envoie depuis le jeu même quand son serveur web est en panne. À reconsidérer pour avoir les alertes de production (surconsommation, sous-production) sur Discord.

## Sécurité et entretien

- [x] Logs limités : systemd à 2 Go, Docker à 3 × 10 Mo par conteneur (`ops/journald/`, `ops/docker/`).
- [x] `#dev` branché sur le repo GitHub (webhook, événement *push*).
- [x] **Bugs FRM signalés** (octobre 2026), avec la cause dans le code et une correction proposée :
  - [#313](https://github.com/porisius/FicsitRemoteMonitoring/issues/313) : serveur web inutilisable après un rechargement de la partie dans le même processus (contourné par le redémarrage complet de 04:10) ;
  - [#314](https://github.com/porisius/FicsitRemoteMonitoring/issues/314) : corps des requêtes POST lu en Latin-1 au lieu d'UTF-8, accents cassés dans le chat du jeu (contourné dans le bot avec des `\uXXXX`). Corrigé par les développeurs le 15/10/2026 ([PR #317](https://github.com/porisius/FicsitRemoteMonitoring/pull/317)), en attente d'une nouvelle version.

## À vérifier en jeu

- [ ] Le multiplicateur d'ascenseur ×5 s'applique aux phases de SF+, et gisements et pureté aléatoires fonctionnent avec les ressources de SF+.
- [ ] Digital Storage : cohabitation avec SF+, et FRM voit-il son contenu ?

## À surveiller au fil de la partie

- [ ] **RAM** : passer au VPS-4 au-delà de 80 % d'utilisation régulière (procédure dans [Architecture](architecture.md#passer-au-vps-4)).
- [ ] **Processeur** : OVH ne communique pas le modèle exact.
- [ ] **Effet de la stack Grafana** sur les performances du jeu : certains endpoints FRM passent par le thread principal du jeu.
- [ ] **Correctifs FRM** dans une nouvelle version : [#313](https://github.com/porisius/FicsitRemoteMonitoring/issues/313) permettra de retirer le redémarrage complet de 04:10, [#314](https://github.com/porisius/FicsitRemoteMonitoring/issues/314) le contournement des accents dans `bot/src/frm.ts`. La 1.5.4 ne corrige ni l'un ni l'autre : #313 vérifié le 15/10/2026 dans les logs du jeu après le rechargement de 04:00 (« Websocket Thread is already running »). Le contournement des accents reste compatible avec la future correction : on pourra le retirer sans urgence.
- [ ] **Nouvelle version de ficsit-cli** où `profile mod add` fonctionne : on pourra alors abandonner le script Python.
- [ ] **SMM gère les clés SSH** (issue #304) : on pourra alors gérer les mods du serveur depuis SMM.
- [ ] **Sortie de FicsIt-Networks** pour la 1.2 (« Works » en 1.2, avec une version serveur Linux).

## Idées pour plus tard

- **Un seul code TypeScript** pour tout ce qui parle à FRM : le client typé du bot (`bot/src/frm.ts`) servira aussi aux alertes perso et à une éventuelle carte.
- **Serveur MCP par-dessus FRM**, pour interroger l'usine en direct depuis Claude.
- **FicsIt-Networks** (quand il sera compatible 1.2) : du Lua 5.4 dans le jeu, avec des ordinateurs, des écrans, des panneaux de contrôle, des splitters programmables et une carte Internet (HTTP sortant uniquement). Sur un serveur dédié, le code tourne a priori côté serveur. Workflow visé : push sur GitHub, puis une GitHub Action fait un `git pull` dans le dossier du disque FIN sur le VPS.
- **Carte ferroviaire web** (optionnelle) : page alimentée par les trains, gares et rails de FRM. Le dashboard Trains de Grafana couvre déjà les positions, horaires, allers-retours et temps de trajet. Une carte perso apporterait le dessin des voies et des signaux, le vrai direct par le WebSocket de FRM et le clic sur un train ou une gare. À réévaluer quand le réseau ferré sera grand.
- **Vitrine publique** des dashboards : Caddy avec HTTPS et un nom de domaine, ou Cloudflare Tunnel.

## Ce que FRM sait faire (pour les idées)

- **Lecture** : usines, énergie, trains, gares, rails, stockages, joueurs, chat, recherches, drones, véhicules…
- **Écriture** (avec le jeton) : message dans le chat, activer ou couper des bâtiments, interrupteurs, marqueurs sur la carte.
- **WebSocket** avec abonnement aux endpoints, pour du temps réel.
- **Webhooks** prêts à l'emploi vers Discord.
