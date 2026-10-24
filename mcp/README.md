# Serveur MCP Lulusia

Un serveur [MCP](https://modelcontextprotocol.io) (Model Context Protocol) qui donne à Claude accès à l'usine en direct. On lui pose une question sur la partie en langage naturel, et il va lire les données du jeu via [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM) :

- « Comment va l'usine ? »
- « Pourquoi je manque de plaques de fer, et qu'est-ce qui coince en amont ? »
- « Prévois une ligne de 10 rotors par minute avec ce que j'ai en trop. »

Il marche depuis claude.ai, l'application de bureau et l'application mobile, pour nos comptes uniquement.

**Lecture seule** : le serveur n'a ni jeton FRM ni méthode d'écriture, il ne peut rien changer dans la partie. Pour piloter l'usine, il y a le [bot Discord](../bot/).

Comme le bot, il parle anglais (descriptions des outils, données), avec les noms d'objets du jeu ; Claude répond dans la langue de la conversation. Le code est commenté en anglais, la documentation reste en français.

## Outils et prompts

Claude choisit lui-même les outils à appeler, souvent plusieurs pour une seule question. Ils sont déclarés en lecture seule, ce qui permet à Claude de les lancer sans demander de confirmation.

| Outil | Ce qu'il renvoie |
|---|---|
| `factory_overview` | L'état de toute l'usine : partie, joueurs connectés, énergie (consommation, capacité, marge, batteries), machines (en production, en pause, arrêtées et pourquoi) et les plus gros déficits. Le point de départ de toute question générale |
| `item_report` | Tout sur un objet : stock (conteneurs et dépôt dimensionnel), production et consommation par minute (actuelles et à pleine vitesse), bilan, temps avant épuisement, et les machines qui le fabriquent ou le consomment, regroupées par recette, avec les entrées et sorties de chaque recette par machine à 100 %. Sert à remonter une chaîne de production étape par étape |
| `production_balance` | Les objets dont la production et la consommation ne s'équilibrent pas : déficits (le pire d'abord, avec le stock restant et le temps avant épuisement) ou excédents (les plus gros d'abord) |
| `machines` | Les machines de production regroupées par bâtiment et recette : combien, combien produisent, sont en pause ou arrêtées et pourquoi, productivité, vitesse, puissance, et la recette par machine à 100 %. Filtres : état, objet fabriqué ou consommé, type de bâtiment. Sert à trouver les goulets d'étranglement |
| `power` | Chaque réseau électrique : consommation actuelle et à pleine charge, capacité, marge, fusibles grillés, batteries, et le total |
| `stock` | Le contenu des stockages (conteneurs et dépôt dimensionnel), les plus grosses quantités d'abord, avec une recherche par nom |

Chaque outil renvoie des données structurées, décrites par un schéma de sortie, et refuse les arguments hors de son schéma. Un nom d'objet peut être partiel et sans majuscules (`iron plate`, `plate`) : s'il est ambigu ou inconnu, l'outil répond avec les noms proches.

Les **prompts** sont des demandes toutes faites, proposées dans le menu de Claude. Les deux acceptent une langue de réponse, le français par défaut.

| Prompt | Demande |
|---|---|
| `factory_checkup` | Un bilan de santé : énergie, déficits et leur cause, machines arrêtées regroupées par cause, puis les trois actions les plus utiles, dans l'ordre |
| `plan_production` | Une nouvelle ligne de production pour un objet et un débit : recettes déjà utilisées par l'usine, bâtiments et quantités, ce que les excédents couvrent, l'énergie nécessaire et ce qui manque |

## Ce que le serveur apprend à Claude

- **Les recettes de Satisfactory Plus** : le modpack change beaucoup de recettes, et Claude connaît surtout celles du jeu de base. Les instructions du serveur lui demandent de se fier aux recettes que montrent les outils : celles des machines de l'usine, avec leurs entrées et sorties par machine à 100 %. FRM a bien des endpoints de recettes (`getRecipes`, `getSchematics`), mais ils font planter le serveur de jeu avec nos mods (voir [`lib/`](../lib/)).
- **Pourquoi une machine est arrêtée** : pas de courant (fusible grillé, ou rien consommé), sortie pleine (le tapis ou le stockage en aval sature), ou entrée manquante (moins que ce qu'il faut pour un cycle). Le calcul est dans [`lib/src/machines.ts`](../lib/src/machines.ts).
- **Débits actuels et à pleine vitesse** : quand les stockages ou les tapis sont pleins, les machines ralentissent et les débits actuels baissent. Les outils donnent aussi les débits à pleine vitesse, pour distinguer un vrai déficit d'une usine saturée.
- **L'énergie avec Refined Power** : FRM donne une production électrique fausse avec ce mod. Les outils s'appuient sur la capacité et la consommation.
- **Données de moins de 10 secondes** : un cache court, partagé par les outils, évite de redemander les mêmes données à FRM quand Claude enchaîne plusieurs outils pour une réponse.
- **FRM en panne** : l'outil renvoie une erreur qui l'explique (serveur de jeu sans doute en train de redémarrer, réessayer dans quelques minutes), au lieu de planter.

## Deux modes

Les deux servent exactement les mêmes outils ([`src/server.ts`](src/server.ts)).

| | Mode distant | Mode local |
|---|---|---|
| Usage | Tous les jours | Développement : essayer une modification sans la déployer |
| Point d'entrée | [`src/http.ts`](src/http.ts), MCP sur HTTP (Streamable HTTP) | [`src/index.ts`](src/index.ts), MCP sur stdio |
| Où il tourne | Docker sur le VPS, publié sur Internet par sa propre machine Tailscale (Funnel) | Sur le PC, lancé par Claude Desktop ou Claude Code |
| Pour qui | Nos comptes Claude, partout : web, bureau, mobile | L'application où il est configuré, Tailscale allumé |
| Authentification | OAuth : connexion GitHub via WorkOS AuthKit, puis liste des comptes autorisés | Aucune : c'est un processus local |
| Accès à FRM | `http://host.docker.internal:8080`, sur l'hôte | `http://lulusia.<nom-du-tailnet>.ts.net:8080`, par Tailscale |

## Mode distant

### Fonctionnement

```
Claude : claude.ai, application de bureau ou mobile
  │  l'appel part des serveurs d'Anthropic, pas de l'appareil
  ▼
Internet ── HTTPS, port 443 ──▶ Tailscale Funnel
                                 │  tunnel Tailscale : aucun port ouvert sur le VPS
                                 ▼
VPS, Docker (projet lulusia-mcp)
  ├─ conteneur tailscale : la machine « lulusia-mcp » du tailnet (tag:mcp), Funnel sur son port 443
  │    │  réseau Docker du projet
  │    ▼
  └─ conteneur mcp (src/http.ts), port 3100
       1. en-tête Host
       2. jeton : signature, émetteur, audience, expiration
       3. compte dans ALLOWED_USERS
       4. outils MCP ──▶ FRM sur l'hôte, en lecture seule

WorkOS AuthKit : connexion par GitHub, délivre les jetons
```

La connexion d'un compte, étape par étape :

1. Claude appelle `/mcp` sans jeton. Le serveur répond 401, avec l'adresse de sa fiche de description (RFC 9728) : `/.well-known/oauth-protected-resource/mcp`.
2. La fiche désigne le serveur d'autorisation : WorkOS AuthKit.
3. Claude s'enregistre tout seul auprès d'AuthKit (Client ID Metadata Document ou enregistrement dynamique) : aucun client OAuth à créer à la main.
4. Le navigateur ouvre la page de connexion d'AuthKit : connexion avec GitHub, qui ne partage que l'adresse e-mail.
5. AuthKit remet à Claude un jeton d'accès : un JWT signé, à durée limitée, valable pour ce serveur seulement (son audience est l'URL publique de `/mcp`).
6. Claude rappelle `/mcp` avec le jeton. Le serveur le vérifie avec les clés publiques d'AuthKit, contrôle que le compte est autorisé, puis répond.

Le serveur ne voit jamais de mot de passe ni de jeton GitHub. C'est un « serveur de ressources » OAuth : il ne fait que vérifier des jetons. Les comptes, la connexion et l'enregistrement de Claude sont chez WorkOS.

### Sécurité

| Couche | Ce qui est vérifié |
|---|---|
| Réseau | Funnel ne publie que le port 443 de la machine Tailscale `lulusia-mcp`, un conteneur à côté du serveur. Rien n'est ouvert dans ufw : cette machine se connecte elle-même aux relais de Tailscale. Le serveur MCP n'est joignable que par ce conteneur et depuis le VPS (`127.0.0.1:3100`) |
| Machine Tailscale | Taguée `tag:mcp` : la politique Tailscale ne lui donne accès à aucune autre machine du tailnet, et c'est la seule autorisée à utiliser Funnel |
| En-tête `Host` | Seuls le nom public, `localhost` et `127.0.0.1` sont acceptés (protection contre le *DNS rebinding*) |
| Jeton | Signé par AuthKit (ses clés publiques sont récupérées et tenues à jour automatiquement). Émetteur, audience et expiration vérifiés : un jeton fait pour un autre serveur est refusé. Sinon : 401 |
| Compte | L'identifiant WorkOS du compte (le `sub` du jeton) doit être dans `ALLOWED_USERS`. Sinon : 403, même avec un jeton valide |
| Connexion | Par GitHub uniquement : pas de mot de passe, pas de lien par e-mail. Inscriptions fermées chez WorkOS une fois nos comptes créés. GitHub ne partage que l'adresse e-mail (`user:email`), et WorkOS ne transmet pas le jeton GitHub |
| Données | Lecture seule : client FRM sans méthode d'écriture et sans jeton FRM. Les tests vérifient que FRM ne reçoit que des lectures |
| Conteneurs | Système de fichiers en lecture seule, aucune capacité Linux, pas d'élévation de privilèges, mémoire et nombre de processus bornés. Le serveur tourne sous l'utilisateur `node`, la machine Tailscale en réseau « userspace » (sans interface réseau ni droits particuliers) |

Sans jeton, on ne peut lire que `/health` (qui répond `ok`) et les fiches de découverte OAuth, publiques par principe.

### Choix

- **Pourquoi Tailscale Funnel** : Claude appelle les connecteurs depuis les serveurs d'Anthropic. Il faut donc une adresse HTTPS publique : le réseau privé Tailscale ne suffit pas. Funnel la fournit sans nom de domaine, sans certificat à gérer et sans ouvrir de port sur le VPS, avec le Tailscale déjà en place pour Grafana et le déploiement. Alternative sans Tailscale : un nom de domaine et Caddy (voir la [feuille de route](../docs/feuille-de-route.md)).
- **Pourquoi une machine Tailscale à part** : Claude ne contacte un serveur MCP que sur le port HTTPS standard, 443. Essayé en 8443 : aucune requête n'arrive. Or le 443 de la machine `lulusia` sert déjà à Grafana, en privé, et Funnel s'active port par port. Une machine dédiée, dans un conteneur, a son propre nom et son propre 443 : Grafana reste privé, le VPS ne publie rien lui-même, et la machine publique n'a accès à rien d'autre dans le tailnet. Le compose du serveur MCP devient aussi autonome, ce qui servira pour une version communautaire.
- **Pourquoi WorkOS AuthKit** : la spécification MCP demande OAuth 2.1, avec un client (Claude) qui s'enregistre tout seul. AuthKit le fait (CIMD, enregistrement dynamique, ressources MCP), propose la connexion GitHub, et son offre gratuite suffit largement. Le serveur n'en dépend que par `OAUTH_ISSUER` et la vérification standard des JWT : un autre serveur d'autorisation conforme ferait l'affaire.
- **Pourquoi GitHub** : pas de mot de passe à gérer, les deux joueurs ont un compte, et la connexion ne donne accès qu'à l'adresse e-mail.
- **Pourquoi une liste de comptes en plus** : AuthKit authentifie (qui est-ce ?), la liste autorise (a-t-il le droit ?). Un inconnu qui obtiendrait un jeton, par exemple si les inscriptions étaient rouvertes par erreur, serait quand même refusé.

### Mise en place et exploitation

Dans [Exploitation, Serveur MCP](../docs/exploitation.md#serveur-mcp-claude) : configuration (`.env`), commandes, ajout d'un compte, mise en place de WorkOS, GitHub, Tailscale et Claude, dépannage.

Le compose lance deux conteneurs : le serveur MCP, dont l'image est construite depuis la racine du repo (elle embarque `lib/`), et sa machine Tailscale (image officielle `tailscale/tailscale`, version épinglée), configurée par [`tailscale/serve.json`](tailscale/serve.json). Ils sont déployés par GitHub Actions comme le bot ([déploiement automatique](../docs/exploitation.md#déploiement-automatique)) ; tant que `mcp/.env` n'existe pas sur le serveur, le déploiement les saute.

## Mode local

Prérequis : Node.js 24 sur le PC, `npm install` à la racine du repo, et Tailscale allumé (FRM est joint par le réseau privé).

**Claude Desktop** : Paramètres, Développeur, Modifier la configuration ouvre `claude_desktop_config.json`. Ajouter le serveur dans l'objet `mcpServers`, à la racine du fichier (le créer s'il n'existe pas, à côté des autres clés), puis redémarrer Claude Desktop :

```json
{
  "mcpServers": {
    "lulusia": {
      "command": "node",
      "args": ["--disable-warning=ExperimentalWarning", "C:\\chemin\\vers\\le\\repo\\mcp\\src\\index.ts"],
      "env": { "FRM_URL": "http://lulusia.<nom-du-tailnet>.ts.net:8080" }
    }
  }
}
```

**Claude Code** :

```bash
claude mcp add --env FRM_URL=http://lulusia.<nom-du-tailnet>.ts.net:8080 --transport stdio lulusia \
  -- node --disable-warning=ExperimentalWarning /chemin/vers/le/repo/mcp/src/index.ts
```

Ne pas garder le mode local et le connecteur distant actifs en même temps dans la même application : Claude verrait chaque outil en double.

En mode local, stdout est réservé au protocole : les messages du serveur vont sur stderr (logs MCP de Claude Desktop).

## Développement et tests

```bash
npm install          # à la racine du repo
npm test             # depuis mcp/, ou depuis la racine pour tout le repo
npm run typecheck
```

Tests avec `node:test` :

| Fichier | Ce qui est testé |
|---|---|
| `test/server.test.ts` | Les six outils et les deux prompts, contre un faux FRM qui sert un extrait anonymisé de la vraie usine : résultats, filtres, noms ambigus, arguments refusés, FRM en panne. Et la lecture seule : FRM n'a reçu que des requêtes de lecture |
| `test/stdio.test.ts` | Le mode local tel que Claude le lance : poignée de main, appel d'un outil, rien d'autre que le protocole sur stdout. Arrêt immédiat avec un message clair sans `FRM_URL` |
| `test/remote.test.ts` | Le mode distant en vrai HTTP, avec un faux serveur d'autorisation qui signe ses propres jetons : défi 401, découverte, jeton valide, jetons refusés (autre audience, autre émetteur, expiré, mauvaise signature, pas un JWT), compte non autorisé (403), en-tête `Host`, émetteur incohérent au démarrage |

`npm run fixtures` reconstruit `test/fixtures/` à partir de vraies réponses de FRM rangées dans `docs/prive/frm-samples/` (privé, jamais dans le repo) : nom de la partie, joueurs, graine de la carte et inventaires anonymisés, et 36 machines sur environ 400, choisies pour couvrir tous les états.

GitHub Actions lance la vérification des types et les tests sous Linux et Windows à chaque push ([`ci.yml`](../.github/workflows/ci.yml)), et avant chaque déploiement ([`deploy.yml`](../.github/workflows/deploy.yml)).

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/server.ts` | Le serveur MCP : instructions pour le modèle, outils et prompts |
| `src/tools/` | Un fichier par outil |
| `src/prompts.ts` | Les deux prompts |
| `src/data.ts` | Les données de l'usine lues dans FRM, derrière le cache de 10 s |
| `src/views.ts` | Calculs communs aux outils : état de l'énergie, regroupement des machines, débits par recette |
| `src/result.ts` | Format des réponses (JSON structuré et texte), erreurs de FRM |
| `src/index.ts` | Point d'entrée du mode local (stdio) |
| `src/http.ts` | Point d'entrée du mode distant : lecture de la configuration, démarrage du serveur HTTP |
| `src/remote.ts` | Le serveur distant, en un seul gestionnaire de requêtes : `Host`, `/health`, découverte OAuth, jeton, liste des comptes, puis MCP |
| `src/auth.ts` | Lecture de la fiche du serveur d'autorisation et vérification des jetons (JWT) |
| `scripts/make-fixtures.ts` | Construction des données de test |
| `Dockerfile`, `docker-compose.yml` | Image du serveur, et les deux conteneurs durcis du mode distant : le serveur et sa machine Tailscale |
| `tailscale/serve.json` | Configuration Funnel de la machine Tailscale : son port 443, public, vers le serveur MCP |
| `.env.example` | Modèle de configuration du mode distant |

Dépendances : le SDK MCP officiel en TypeScript (`@modelcontextprotocol/server`, `@modelcontextprotocol/node` pour le serveur HTTP de Node, `@modelcontextprotocol/client` pour les tests), `jose` (JWT), `zod` (schémas des outils), et [`@lulusia/lib`](../lib/) (client FRM et calculs).
