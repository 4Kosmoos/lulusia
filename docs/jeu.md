# Le jeu

Satisfactory **1.2** (branche stable), sur Steam pour les deux joueurs, avec un serveur dédié sous Linux.

## Rejoindre la partie

1. Installer [Satisfactory Mod Manager](https://smm.ficsit.app/) (SMM).
2. Importer le profil [`mods/Lulusia.smmprofile`](../mods/Lulusia.smmprofile) : il contient la liste exacte des mods et leurs versions.
3. Lancer le jeu depuis SMM avec le profil « Lulusia », puis rejoindre le serveur.

Le serveur et les deux PC doivent avoir **exactement les mêmes mods dans les mêmes versions**.

## Mods

Tous vérifiés sur ficsit.app : compatibles 1.2 (« Works » en Stable), avec une version serveur Linux.

| Mod | Rôle |
|---|---|
| **Satisfactory Plus (SF+)** | Refonte complète du jeu. Impose une nouvelle partie. Fixe les versions de Refined Power, Ficsit Farming et Fluid Extras |
| Refined Power | Remplace l'énergie vanilla (modifié par SF+). Installé avec SF+ |
| Ficsit Farming | Agriculture. Installé avec SF+ |
| Fluid Extras | Fluides supplémentaires. Installé avec SF+ |
| Structural Solutions | Construction, officiellement supporté par SF+ |
| Smart! | Construction de masse |
| Efficiency Checker | Diagnostic machine par machine en jeu |
| Digital Storage | Stockage numérique. Cohabitation avec SF+ et visibilité par FRM à vérifier |
| **Ficsit Remote Monitoring (FRM)** | API JSON (port 8080), WebSocket et webhooks : la source de données de Grafana et du bot. Dépend de SML 3.12 ou plus |

SF+ installe aussi une dizaine de bibliothèques (KLib, KAPI, RefinedRDLib, ModularUI…). Sur les PC, SMM s'en occupe tout seul. Sur le serveur, elles sont listées une par une dans le profil ficsit-cli.

FicsIt-Networks (ordinateurs programmables en Lua) viendra quand il sera compatible 1.2.

### Versions installées

Profil SMM et profil ficsit-cli « Lulusia », installés le 25/09/2026. Les 22 mods ont une version serveur Linux et le mod loader les charge tous.

| Mod | Référence | Version | Remarque |
|---|---|---|---|
| Satisfactory Mod Loader | SML | 3.12.0 | |
| SatisfactoryPlus | SatisfactoryPlus | 2026.3.489 | |
| Refined Power | RefinedPower | 2026.3.28 | Dépendance de SF+ |
| Ficsit Farming | FicsitFarming | 2026.3.18 | Dépendance de SF+ |
| Fluid Extras | AB_FluidExtras | 1.0.13 | Dépendance de SF+ |
| Structural Solutions | SS_Mod | 1.1.47 | |
| Smart! | SmartFoundations | 34.3.1 | |
| Efficiency Checker | EfficiencyCheckerMod | 2.5.17 | |
| Digital Storage | DigitalStorage | 2026.3.11 | |
| Ficsit Remote Monitoring | FicsitRemoteMonitoring | 1.5.3 | |
| Enhanced Sorting | EnhancedSorting | 1.0.4 | Même auteur que Digital Storage, probablement sa dépendance |
| Marcio Common Libs | MarcioCommonLibs | 1.3.12 | Dépendance d'Efficiency Checker |
| Cross-Mod Compatibility Packs | KPatchwork | 2026.3.81 | Bibliothèque KMods |
| KMods Blueprint Function Library | KBFL | 2026.3.506 | Bibliothèque KMods |
| KMods Library - API | KAPI | 2026.3.506 | Bibliothèque KMods |
| KMods Library - Code | KPrivateCodeLib | 2026.3.514 | Bibliothèque KMods |
| KMods Library - Content | KLib | 2026.3.512 | Bibliothèque KMods |
| KMods Library - UI/UX | KUI | 2026.3.511 | Bibliothèque KMods |
| Satisfactory Content Forge | KDataForge | 2026.3.570 | Bibliothèque KMods |
| Modular UI | ModularUI | 2026.3.8 | Bibliothèque |
| RefinedRDApi | RefinedRDApi | 2026.3.12 | Bibliothèque Refined R&D |
| RefinedRDLib | RefinedRDLib | 2026.3.44 | Bibliothèque Refined R&D |

Pour mettre à jour un mod, voir [Exploitation](exploitation.md#mettre-à-jour-un-mod), et mettre ce tableau à jour.

### Mods écartés

| Mod | Raison |
|---|---|
| Modular Load Balancers | Retiré par choix |
| Cartograph | Pas compatible avec notre config, et ne dessinait pas les bâtiments moddés |
| Discord Rich Presence | Inutile : le salon `#statut` fait mieux. Côté client uniquement, donc réinstallable à tout moment |
| Storage Teleporter | Rendrait inutiles les trains, camions et drones |
| Multidimensional Factory | Pas pour cette partie |
| Daisy Chain Smart Input Factory | Le chaînage électrique est natif en 1.2 (MAM, arbre Caterium, « Upgraded Power Connections ») |
| Heavy Fluid Overhaul | Ne gère pas la plupart des machines moddées |
| Mk++, Buildable ResourceNodes MM Addon | Incompatibles, et désactivés par SF+ de toute façon |
| Area Actions | Pas encore compatible 1.2 |
| Difficulty Tuner | Pas compatible, et remplacé par les modes de jeu de la 1.2 |
| More Players | Inutile à deux |
| FactorioToSatisfactory | Hors sujet |

## Réglages de la partie (modes de jeu 1.2)

⚠️ **Définitifs** une fois la partie créée. Ils ne désactivent pas les succès Steam.

| Réglage | Valeur |
|---|---|
| Multiplicateur de l'ascenseur orbital | **×5** |
| Multiplicateur du coût des formules | ×1 |
| Multiplicateur de consommation d'énergie | ×1 |
| Gisements | **Aléatoire** (le type change, pas l'emplacement) |
| Pureté des gisements | **Aléatoire** (sauf les geysers) |
| Graine du monde | 1497608832 (tirée au hasard) |
| Tutoriel | Fait en solo avant l'envoi sur le serveur (exigence de SF+) |

Réglages confirmés sur le serveur par FRM (`getSessionInfo`) : `SpaceElevatorCost` 5, `RecipeCost` 1, `PowerCost` 1, `NodeRando` Random, `NodePurity` Random.

**Succès Steam** : d'après la communauté, les mods ne les coupent pas. Ne **jamais** activer le mode Créatif, qui les désactive définitivement pour la partie. Si aucun succès ne tombe, tester le jeu en anglais (bug connu en 2024).

## Création de la partie

Un serveur dédié saute le tutoriel, alors que SF+ l'exige (sinon plantage, selon une ancienne fiche du mod). Méthode suivie :

1. Créer le monde **en solo**, avec exactement les mêmes mods et réglages (jeu lancé via SMM, profil Lulusia).
2. Faire le tutoriel et sauvegarder.
3. Gestionnaire de serveur, onglet « Sauvegardes » : « Envoyer sauv. », puis « Charger sauv. » et **« Charger une partie »** (jamais « Charger avec le mode créatif »).

Les mods doivent être installés sur le serveur **avant** d'y charger une sauvegarde SF+ : un serveur sans mods ne sait pas lire les objets ajoutés par les mods.

Au chargement :

- Le message « Could not read save mod metadata. Mod compatibility check was skipped. » est sans conséquence ici, car les mods du serveur ont été vérifiés à la main (mêmes 22 mods, mêmes versions).
- Le serveur reste injoignable ou très lent (plus de 10 s de latence) pendant 2 à 3 minutes : environ 40 s pour charger la carte, puis la préparation du monde. Ne pas relancer le chargement pendant ce temps.

## Fichiers locaux et Steam Cloud

La partie Lulusia vit sur le serveur, pas dans Steam Cloud. Steam Cloud ne synchronise que les fichiers du PC (`%LOCALAPPDATA%\FactoryGame\Saved\SaveGames` : parties solo, réglages, plans). En cas d'erreur de synchronisation, faire d'abord une copie de ce dossier, puis relancer la synchronisation depuis Steam.
