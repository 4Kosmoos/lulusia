# ops/

Les fichiers installés à la main sur le serveur, versionnés ici pour ne pas les perdre et pouvoir reconstruire le serveur. **Le repo est la référence** : une modification se fait ici d'abord, puis s'installe sur le serveur.

| Fichier du repo | Installé sur le serveur | Rôle |
|---|---|---|
| `scripts/lulusia-backup` | `/usr/local/bin/lulusia-backup` | Archive les parties et les configs dans `/var/backups/lulusia` |
| `scripts/lulusia-status` | `/usr/local/bin/lulusia-status` | Vue d'ensemble du serveur |
| `scripts/lulusia-deploy` | `/usr/local/bin/lulusia-deploy` | Déploiement du bot et du serveur MCP, lancé par GitHub Actions ou à la main |
| `scripts/lulusia-watchdog` | `/usr/local/bin/lulusia-watchdog` | Redémarre le serveur si FRM ne répond plus (3 fois par jour au maximum) |
| `systemd/satisfactory.service` | `/etc/systemd/system/` | Le serveur de jeu (utilisateur `steam`, `Restart=always`) |
| `systemd/satisfactory-full-restart.service` et `.timer` | `/etc/systemd/system/` | Redémarrage complet à 04:10 UTC (contournement du bug FRM), seulement si le serveur tourne |
| `systemd/lulusia-backup.service` et `.timer` | `/etc/systemd/system/` | Sauvegarde à 00:15, 06:15, 12:15 et 18:15 UTC |
| `systemd/lulusia-watchdog.service` et `.timer` | `/etc/systemd/system/` | Watchdog de FRM toutes les 5 minutes |
| `ssh/00-hardening.conf` | `/etc/ssh/sshd_config.d/` | SSH : clé uniquement, pas de root |
| `journald/lulusia.conf` | `/etc/systemd/journald.conf.d/` | Logs systemd limités à 2 Go |
| `docker/daemon.json` | `/etc/docker/` | Logs des conteneurs Docker limités à 3 × 10 Mo par conteneur |
| `monitoring/docker-compose.override.yml` | `/home/ubuntu/satisfactory-monitoring/` | Notre adaptation de la stack Grafana (rien de publié sur Internet) |
| `monitoring/.env.example` | modèle du `.env` de la stack | Le vrai `.env` n'existe que sur le serveur |
| (pas dans le repo) | `/home/ubuntu/.ssh/authorized_keys` | Clé de déploiement de GitHub Actions, avec ses restrictions ([procédure](../docs/exploitation.md#déploiement-automatique)) |

## Vérifier que le serveur correspond au repo

Sur le serveur, après un `git pull` :

```bash
bash ~/lulusia/ops/check.sh
```

Chaque fichier doit être marqué ✔. En cas de ✘, la commande affichée montre la différence.

## Installer une modification

Sur le serveur, depuis `~/lulusia/ops` après un `git pull`, seulement pour la partie modifiée :

```bash
# Scripts
sudo install -m 755 scripts/lulusia-backup scripts/lulusia-status scripts/lulusia-watchdog scripts/lulusia-deploy /usr/local/bin/

# Services et timers
sudo install -m 644 systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
systemctl list-timers --no-pager | grep -E 'lulusia|satisfactory'

# Stack Grafana
cp monitoring/docker-compose.override.yml ~/satisfactory-monitoring/
(cd ~/satisfactory-monitoring && sudo docker compose up -d)

# Logs systemd
sudo install -d /etc/systemd/journald.conf.d
sudo install -m 644 journald/lulusia.conf /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald

# Logs Docker (redémarre Docker et tous les conteneurs : quelques secondes de coupure pour Grafana, le bot et le serveur MCP)
sudo install -m 644 docker/daemon.json /etc/docker/
sudo systemctl restart docker
(cd ~/satisfactory-monitoring && sudo docker compose up -d --force-recreate)
(cd ~/lulusia/bot && sudo docker compose up -d --force-recreate)
(cd ~/lulusia/mcp && sudo docker compose up -d --force-recreate)

# SSH : garder une session ouverte pendant l'opération, au cas où
sudo install -m 644 ssh/00-hardening.conf /etc/ssh/sshd_config.d/
sudo sshd -t && sudo systemctl reload ssh
```

Puis `bash check.sh` pour vérifier, et `lulusia-status` pour l'état général.

## Serveur neuf

Sur un serveur reconstruit, en plus des fichiers ci-dessus, activer les services et les timers :

```bash
sudo systemctl enable --now satisfactory lulusia-backup.timer satisfactory-full-restart.timer lulusia-watchdog.timer
```

Le reste de l'installation (sécurisation, SteamCMD, mods, Docker, Tailscale) n'est pas scripté : [`docs/`](../docs/) décrit l'état attendu de chaque brique, à reproduire à la main.
