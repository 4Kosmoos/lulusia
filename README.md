# Lulusia

![Lulusia](images/lulusia.jpg)

Un serveur **Satisfactory 1.2 moddé** (Satisfactory Plus et une vingtaine de mods) qui tourne 24 h/24 pour deux joueurs, avec tout un outillage autour :

- **dashboards Grafana** : production, énergie, trains, drones, stockages… ;
- **bot Discord** en TypeScript : état du serveur en direct, pont avec le chat du jeu, bientôt des commandes pour piloter l'usine ;
- **alertes Discord** : fusible grillé, batteries, trains, recherches, joueurs connectés ;
- **sauvegardes automatiques** et entretien du serveur.

Toutes les données de l'usine viennent du mod [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM), qui expose une API JSON depuis le jeu.

## Architecture

```
Poste de développement          Serveur de production (VPS, Ubuntu 24.04)            Interfaces
──────────────────────          ─────────────────────────────────────────            ──────────
Satisfactory + SMM ── jeu ────▶ Serveur dédié Satisfactory (systemd)
                                  └─ FRM : API de l'usine (réseau privé)
                                        ▲                  ▲
Repo lulusia                            │ lecture          │ lecture / écriture
  ├─ docs/                      Grafana (Docker) ──────────┼──── Tailscale ────▶ Navigateur
  ├─ bot/ ──── git pull ──────▶ Bot Discord (Docker) ──────┴───────────────────▶ Discord
  └─ ops/ ──── installation ──▶ Sauvegardes, redémarrage quotidien, supervision
```

- **Le repo est la source de vérité** : code, configuration du serveur et documentation.
- **Le serveur est déployé depuis le repo** (`git pull`), sans modification manuelle.
- **Surface d'exposition minimale** : seuls le jeu et l'accès SSH par clé sont ouverts sur Internet. La supervision et l'API de l'usine passent par un réseau privé (Tailscale).

## Contenu du repo

| Dossier | Contenu |
|---|---|
| [`docs/`](docs/) | La doc du projet (voir ci-dessous) |
| [`bot/`](bot/) | Bot Discord : TypeScript, discord.js, Docker |
| [`ops/`](ops/) | Ce qui est installé à la main sur le serveur : scripts, services systemd, config de la stack Grafana |
| [`mods/`](mods/) | Profil SMM « Lulusia » (liste exacte des mods et versions) |
| [`images/`](images/) | Images du projet |

## Documentation

| Document | Pour quoi faire |
|---|---|
| [Architecture](docs/architecture.md) | Ce qui tourne où, réseau, sécurité, hébergement, Discord |
| [Le jeu](docs/jeu.md) | Mods, versions, réglages de la partie |
| [Exploitation](docs/exploitation.md) | Mode d'emploi : commandes, mises à jour, sauvegardes, bugs connus |
| [Feuille de route](docs/feuille-de-route.md) | Ce qui est fait, ce qui reste, les idées |

## Stack

Ubuntu 24.04 sur un VPS OVH · serveur dédié Satisfactory (SteamCMD) · SML 3.12 et ficsit-cli · Ficsit Remote Monitoring · Docker Compose · Grafana, Prometheus, Postgres ([satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring)) · Tailscale · Node.js 24, TypeScript, discord.js.

## Remerciements

- [Ficsit Remote Monitoring](https://ficsit.app/mod/FicsitRemoteMonitoring) (porisius et contributeurs) pour l'API de l'usine.
- [satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring) (featheredtoast) pour la stack Grafana.
- [Satisfactory Plus](https://ficsit.app/mod/SatisfactoryPlus) (KMods) et tous les auteurs des mods utilisés.
- La communauté du [Satisfactory Modding](https://ficsit.app/).
