# Lulusia

[![CI](https://github.com/4Kosmoos/lulusia/actions/workflows/ci.yml/badge.svg)](https://github.com/4Kosmoos/lulusia/actions/workflows/ci.yml)
[![Deploy](https://github.com/4Kosmoos/lulusia/actions/workflows/deploy.yml/badge.svg)](https://github.com/4Kosmoos/lulusia/actions/workflows/deploy.yml)

A modded **Satisfactory 1.2** dedicated server (Satisfactory Plus and about twenty other mods) that runs 24/7 for two players, operated like a small production service: live dashboards, a Discord bot that can drive the factory, an **MCP server that lets Claude read the factory live**, automated deployment, backups, monitoring and a hardened, minimal attack surface.

Every piece of factory data comes from the [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) mod (FRM), which exposes a JSON API from inside the game.

> This README is the English overview. The detailed documentation in [`docs/`](docs/) and the component READMEs are in French.

## Highlights

- **Ask Claude about the factory.** A remote [MCP](https://modelcontextprotocol.io) server gives Claude six read-only tools (factory overview, item report, production balance, machines, power, stock) and two ready-made prompts (factory checkup, plan a production line). It works from claude.ai, the desktop and the mobile apps, signed in with GitHub through OAuth, for an allowlist of two accounts. [More](mcp/)
- **Discord bot** in TypeScript: a live status message, a two-way bridge with the in-game chat, slash commands and `!` commands typed in the game (stock, power, players, in-game markers), factory control (power switches, pausing every machine that makes an item), personal alerts (low stock, item consumed faster than produced) and server monitoring. [More](bot/)
- **Grafana dashboards** for production, power, trains, drones and storage, private to our devices over Tailscale.
- **Operations as code**: systemd services and timers for the game server, backups every 6 hours, a daily full restart and a watchdog that restarts the server when FRM stops answering, all versioned in [`ops/`](ops/) with a script that checks the server still matches the repo.
- **CI/CD**: type checks and tests on Linux and Windows on every push, then deployment to the VPS through Tailscale, with no long-lived Tailscale secret and an SSH key that can run a single command.
- **Upstream bug reports** to FRM, each with the root cause in its C++ source and a proposed fix: [#313](https://github.com/porisius/FicsitRemoteMonitoring/issues/313), [#314](https://github.com/porisius/FicsitRemoteMonitoring/issues/314) (fixed upstream), [#321](https://github.com/porisius/FicsitRemoteMonitoring/issues/321).

## Architecture

```
Development PC                  Production server (VPS, Ubuntu 24.04)                 Interfaces
──────────────                  ─────────────────────────────────────                 ──────────
Satisfactory + SMM ── game ───▶ Satisfactory dedicated server (systemd)
                                  └─ FRM: the factory's JSON API (private)
                                        ▲             ▲         ▲
lulusia repo                            │ read        │ read    │ read / write
  ├─ docs/                      Grafana (Docker) ─────┼─────────┼── Tailscale ──────▶ Browser
  ├─ lib/ ─┐                 ┌▶ MCP server (Docker) ──┴─────────┼── Funnel, OAuth ──▶ Claude
  ├─ mcp/ ─┼─ GitHub Actions ┤                                  │
  ├─ bot/ ─┘                 └▶ Discord bot (Docker) ───────────┴───────────────────▶ Discord
  └─ ops/ ──── install ───────▶ Backups, daily restart, watchdog, monitoring
```

- **The repo is the source of truth**: code, server configuration and documentation. The server is deployed from it, never edited by hand.
- **Minimal exposure**: only the game ports and key-only SSH are open on the Internet. Dashboards and the factory API stay on a private Tailscale network.
- **The MCP server is the one public service.** It sits behind its own Tailscale machine, published with Funnel, so no port is opened on the VPS. Requests must carry an OAuth token issued for this server and belong to an allowed account.

## Engineering notes

A few problems met along the way, and how they were solved:

- **Claude only reaches MCP servers on port 443.** The VPS's own 443 already serves Grafana privately, and Funnel works port by port. The MCP server therefore gets its own Tailscale machine, a container next to it with its own name and port 443. It is tagged so that it can reach nothing else in the network and is the only machine allowed to use Funnel.
- **Read-only by construction.** The MCP server uses an FRM client type that has no write methods and no FRM token. The tests check that FRM only ever receives read requests.
- **The modpack changes the recipes.** Claude knows the vanilla game; the server tells it to trust the recipes read from the factory's own machines, with their rates at 100% clock speed.
- **FRM's web server dies after an in-process save reload.** A watchdog timer restarts the game server after 5 to 10 minutes of silence (3 times a day at most), and a full restart runs after the nightly reload. Root cause reported in [#313](https://github.com/porisius/FicsitRemoteMonitoring/issues/313).
- **Accents garbled in the in-game chat.** FRM decoded POST bodies as Latin-1; the bot sends pure-ASCII JSON escapes until the upstream fix ships ([#314](https://github.com/porisius/FicsitRemoteMonitoring/issues/314)).
- **One endpoint crashes the game server.** With our mods, `getSchematics` dereferences a null recipe. Found from the crash stack and FRM's source, reported with a fix in [#321](https://github.com/porisius/FicsitRemoteMonitoring/issues/321); our tools avoid it.
- **Deploying without stored secrets.** GitHub Actions joins the tailnet as a temporary tagged machine through OIDC workload identity federation. Its SSH key is restricted to a single command, from Tailscale addresses only, and the policy limits it to port 22 of the VPS.

## Security

| Area | Measures |
|---|---|
| Network | `ufw` with only the game ports and SSH open. FRM's port is blocked, and container ports are bound to localhost and reached through Tailscale |
| SSH | Key-only with a passphrase, no root login, fail2ban, automatic security updates |
| MCP server | OAuth 2.1 through WorkOS AuthKit (GitHub sign-in only, sign-ups closed), JWT checked for signature, issuer, audience and expiry, account allowlist, `Host` header check, read-only data |
| Containers | Bot, MCP server and its Tailscale machine: read-only file systems, no Linux capabilities, no privilege escalation, memory and process limits |
| Deployment | OIDC instead of stored Tailscale keys, forced-command SSH key, actions pinned to a commit |
| Secrets | Only in `.env` files on the server and in a password manager: no tokens, webhooks, addresses or host names in the repo |

## Repository

| Folder | Contents |
|---|---|
| [`mcp/`](mcp/) | MCP server for Claude: TypeScript, the official MCP SDK, OAuth resource server, Docker with its Tailscale sidecar |
| [`bot/`](bot/) | Discord bot: TypeScript, discord.js, Docker |
| [`lib/`](lib/) | Shared code: typed FRM client and the factory calculations (stock, balance, power, machine states), with tests |
| [`ops/`](ops/) | What is installed by hand on the server: scripts, systemd units, Grafana stack configuration, and a check that the server matches the repo |
| [`docs/`](docs/) | Architecture, the game setup, the operations manual and the roadmap (in French) |
| [`mods/`](mods/) | The exact mod list and versions (SMM profile) |

## Documentation (French)

| Document | What for |
|---|---|
| [Architecture](docs/architecture.md) | What runs where, network, security, hosting, Discord, Claude |
| [The game](docs/jeu.md) | Mods, versions, game settings |
| [Operations](docs/exploitation.md) | Day-to-day manual: commands, updates, deployment, backups, MCP server, known bugs |
| [Roadmap](docs/feuille-de-route.md) | What is done, what is left, ideas |

## Stack

Ubuntu 24.04 on an OVH VPS · Satisfactory dedicated server (SteamCMD) · SML 3.12 and ficsit-cli · Ficsit Remote Monitoring · Docker Compose · Grafana, Prometheus, Postgres ([satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring)) · Tailscale (private network and Funnel) · Node.js 24, TypeScript, discord.js · MCP (official TypeScript SDK), WorkOS AuthKit · GitHub Actions.

## Acknowledgements

- [Ficsit Remote Monitoring](https://ficsit.app/mod/FicsitRemoteMonitoring) (porisius and contributors) for the factory API.
- [satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring) (featheredtoast) for the Grafana stack.
- [Satisfactory Plus](https://ficsit.app/mod/SatisfactoryPlus) (KMods) and the authors of every mod we use.
- The [Satisfactory Modding](https://ficsit.app/) community.
