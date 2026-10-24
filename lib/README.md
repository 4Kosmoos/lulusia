# Code partagé (`@lulusia/lib`)

Le code TypeScript commun aux outils du repo qui lisent la partie via [Ficsit Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/) (FRM) : le [bot Discord](../bot/) et le [serveur MCP](../mcp/). Aucune dépendance : seulement Node.js 24.

| Fichier | Contenu |
|---|---|
| `src/frm.ts` | Client typé de l'API FRM. `createFrmReader` ne contient que les lectures ; `createFrmClient` ajoute les écritures (chat, marqueurs, interrupteurs, machines), avec le jeton FRM |
| `src/inventory.ts` | Stocks (conteneurs et dépôt dimensionnel), rythmes de production et de consommation, bilan, temps avant épuisement |
| `src/power.ts` | Réseaux électriques : consommation, capacité, marge à pleine charge, batteries |
| `src/machines.ts` | Machines de production : en production, en pause ou arrêtée et pourquoi (pas de courant, sortie pleine, entrée manquante), regroupement par bâtiment et recette, débits d'une recette à 100 % |
| `src/search.ts` | Retrouver un nom tapé parmi ceux du jeu (accents et majuscules ignorés, nom partiel, ambiguïtés) |
| `src/cache.ts` | Cache court devant FRM, qui regroupe les appels simultanés |
| `src/format.ts` | Nombres et durées au format anglais du jeu (`1,000`, `50.4%`, `2h 05m`) |

Le texte des réponses (Markdown de Discord, emoji) reste dans chaque outil : ici, seulement les données et les calculs.

**Endpoints FRM écartés** : `getSchematics` fait planter le serveur de jeu avec nos mods, et `getRecipes` a le même défaut : FRM 1.5.4 utilise sans la vérifier une recette vide, probablement listée par un mod mais absente du jeu ([#321](https://github.com/porisius/FicsitRemoteMonitoring/issues/321)). Le client ne les propose pas.

## Utilisation

C'est un workspace npm : les autres workspaces l'importent par son nom, fichier par fichier.

```ts
import { createFrmReader } from "@lulusia/lib/frm";
import { loadInventory, reportFor } from "@lulusia/lib/inventory";
```

Node exécute le TypeScript directement. npm relie `node_modules/@lulusia/lib` à ce dossier par un lien, ce qui est indispensable : Node refuse le TypeScript situé dans `node_modules`, mais suit le lien jusqu'au vrai dossier.

## Tests

```bash
npm test           # depuis ce dossier ; ou depuis la racine, pour tout le repo
npm run typecheck
```

Tests avec `node:test`, sans dépendance. Le client FRM est testé contre un faux serveur FRM local : erreurs de FRM, délai dépassé, serveur arrêté, jeton absent, encodage des accents. GitHub Actions les lance à chaque push, sous Linux et Windows, et avant chaque déploiement.
