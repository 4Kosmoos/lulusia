# Lulusia

[![CI](https://github.com/4Kosmoos/lulusia/actions/workflows/ci.yml/badge.svg)](https://github.com/4Kosmoos/lulusia/actions/workflows/ci.yml)
[![Deploy](https://github.com/4Kosmoos/lulusia/actions/workflows/deploy.yml/badge.svg)](https://github.com/4Kosmoos/lulusia/actions/workflows/deploy.yml)

![Lulusia](images/lulusia.jpg)

Un serveur **Satisfactory 1.2 moddé** (Satisfactory Plus et une vingtaine de mods) qui tourne 24 h/24 pour deux joueurs, avec tout un outillage autour :

- **dashboards Grafana** : production, énergie, trains, drones, stockages… ;
- **bot Discord** en TypeScript : état du serveur en direct, pont avec le chat du jeu, commandes pour interroger l'usine (stocks, énergie, joueurs), la piloter (interrupteurs électriques, pause et relance des machines par objet) et poser des marqueurs en jeu, depuis Discord ou le chat du jeu ;
- **serveur MCP pour Claude** : on interroge l'usine en direct, en langage naturel (« pourquoi je manque de plaques de fer ? », « prévois une ligne de 10 rotors par minute »), depuis claude.ai, l'application de bureau ou mobile. En lecture seule, et réservé à nos comptes ;
- **alertes Discord** : fusible grillé, batteries, trains, recherches, serveur qui ne répond plus, RAM ou disque presque pleins, et alertes perso (stock bas, objet consommé plus vite que produit) aussi annoncées dans le jeu ;
- **sauvegardes automatiques** et entretien du serveur.

Toutes les données de l'usine viennent du mod [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM), qui expose une API JSON depuis le jeu.

## Architecture

```
Poste de développement          Serveur de production (VPS, Ubuntu 24.04)                    Interfaces
──────────────────────          ─────────────────────────────────────────                    ──────────
Satisfactory + SMM ── jeu ────▶ Serveur dédié Satisfactory (systemd)
                                  └─ FRM : API de l'usine (réseau privé)
                                        ▲              ▲              ▲
Repo lulusia                            │ lecture      │ lecture      │ lecture / écriture
  ├─ docs/                      Grafana (Docker) ──────┼──────────────┼─── Tailscale ──────▶ Navigateur
  ├─ lib/ ─┐                 ┌▶ Serveur MCP (Docker) ──┴──────────────┼─── Funnel, OAuth ──▶ Claude
  ├─ mcp/ ─┼─ GitHub Actions ┤                                        │
  ├─ bot/ ─┘                 └▶ Bot Discord (Docker) ─────────────────┴────────────────────▶ Discord
  └─ ops/ ──── installation ──▶ Sauvegardes, redémarrage quotidien, supervision
```

- **Le repo est la source de vérité** : code, configuration du serveur et documentation.
- **Le serveur est déployé depuis le repo** : à chaque push, GitHub Actions vérifie le code (types et tests) puis déploie le bot et le serveur MCP, sans modification manuelle.
- **Surface d'exposition minimale** : seuls le jeu et l'accès SSH par clé sont ouverts sur Internet. La supervision et l'API de l'usine passent par un réseau privé (Tailscale). Le serveur MCP est publié par Tailscale Funnel, sans port ouvert sur le VPS, derrière une connexion OAuth et une liste de comptes.

## Contenu du repo

| Dossier | Contenu |
|---|---|
| [`docs/`](docs/) | La doc du projet (voir ci-dessous) |
| [`bot/`](bot/) | Bot Discord : TypeScript, discord.js, Docker |
| [`mcp/`](mcp/) | Serveur MCP pour Claude : TypeScript, SDK MCP officiel, OAuth (WorkOS AuthKit), Docker |
| [`lib/`](lib/) | Code partagé par le bot et le serveur MCP : client typé de l'API FRM et calculs sur ses données (stocks, bilan, énergie, état des machines), avec ses tests |
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

Ubuntu 24.04 sur un VPS OVH · serveur dédié Satisfactory (SteamCMD) · SML 3.12 et ficsit-cli · Ficsit Remote Monitoring · Docker Compose · Grafana, Prometheus, Postgres ([satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring)) · Tailscale (réseau privé et Funnel) · Node.js 24, TypeScript, discord.js · MCP (SDK TypeScript officiel), WorkOS AuthKit · GitHub Actions.

## Remerciements

- [Ficsit Remote Monitoring](https://ficsit.app/mod/FicsitRemoteMonitoring) (porisius et contributeurs) pour l'API de l'usine.
- [satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring) (featheredtoast) pour la stack Grafana.
- [Satisfactory Plus](https://ficsit.app/mod/SatisfactoryPlus) (KMods) et tous les auteurs des mods utilisés.
- La communauté du [Satisfactory Modding](https://ficsit.app/).
