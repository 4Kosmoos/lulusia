// Lieux nommés de la partie (HUB, gares, marqueurs de carte, joueurs), pour /joueurs et /ping.

import { formatNumber } from "../format.ts";
import { frm, type Location, type Player } from "../frm.ts";
import { cached, type Candidate } from "./shared.ts";

export type PlaceKind = "hub" | "station" | "marker" | "player";

export interface Place {
  /** Identifiant stable, utilisé comme valeur dans l'autocomplétion. */
  key: string;
  kind: PlaceKind;
  name: string;
  location: Location;
}

const ICONS: Record<PlaceKind, string> = { hub: "🏠", station: "🚉", marker: "🚩", player: "👷" };
const KIND_ORDER: PlaceKind[] = ["hub", "station", "marker", "player"];

export const placeLabel = (place: Place): string => `${ICONS[place.kind]} ${place.name}`;

/** HUB, gares et marqueurs de carte, lus à l'instant. */
export async function loadNamedPlaces(): Promise<Place[]> {
  const [hubs, stations, markers] = await Promise.all([frm.hubTerminals(), frm.trainStations(), frm.mapMarkers()]);
  return [
    ...hubs.map((h): Place => ({ key: `hub:${h.ID}`, kind: "hub", name: "HUB", location: h.location })),
    ...stations.map((s): Place => ({ key: `station:${s.ID}`, kind: "station", name: s.Name || "Gare sans nom", location: s.location })),
    ...markers.map((m): Place => ({ key: `marker:${m.ID}`, kind: "marker", name: m.Name || m.Category || "Marqueur sans nom", location: m.location })),
  ];
}

/** Pour l'autocomplétion : lieux nommés gardés 30 s, joueurs gardés 5 s. */
export const cachedNamedPlaces = cached(loadNamedPlaces, 30_000);
export const cachedPlayers = cached(() => frm.players(), 5_000);

export function playerPlaces(players: Player[]): Place[] {
  return players
    .filter((p) => p.Online)
    .map((p): Place => ({ key: `player:${p.ID}`, kind: "player", name: p.Name || "Pionnier sans nom", location: p.location }));
}

export function placeCandidates(places: Place[]): Candidate[] {
  return [...places]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "fr"))
    .map((place) => ({
      label: place.kind === "player" ? `${placeLabel(place)} (joueur)` : placeLabel(place),
      value: place.key,
      search: place.name,
    }));
}

/** Distance au sol, en mètres (les coordonnées du jeu sont en centimètres). */
function groundDistance(from: Location, to: Location): number {
  return Math.hypot(to.x - from.x, to.y - from.y) / 100;
}

const DIRECTIONS = ["au nord", "au nord-est", "à l'est", "au sud-est", "au sud", "au sud-ouest", "à l'ouest", "au nord-ouest"];

/** Direction de `to` vue depuis `from`. Dans le jeu, x va vers l'est et y vers le sud. */
function direction(from: Location, to: Location): string {
  const degrees = (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI;
  return DIRECTIONS[Math.round(((degrees + 360) % 360) / 45) % 8];
}

function distanceText(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${formatNumber(meters / 1000)} km`;
}

/** « à Gare Fer », « au HUB », « de Gare Fer », « du HUB » (avec l'icône du lieu si `icons`). */
function withPreposition(place: Place, preposition: "à" | "de", icons: boolean): string {
  const label = icons ? placeLabel(place) : place.name;
  if (place.kind === "hub") return `${preposition === "à" ? "au" : "du"} ${label}`;
  return `${preposition} ${label}`;
}

/** « à 350 m au nord-est de 🚉 Gare Fer », d'après le lieu nommé le plus proche. */
export function whereIs(location: Location, places: Place[], icons = true): string {
  if (places.length === 0) return "position inconnue (aucun lieu nommé)";
  const nearest = places.reduce((best, place) =>
    groundDistance(location, place.location) < groundDistance(location, best.location) ? place : best,
  );
  const meters = groundDistance(nearest.location, location);
  if (meters < 50) return withPreposition(nearest, "à", icons);
  return `à ${distanceText(meters)} ${direction(nearest.location, location)} ${withPreposition(nearest, "de", icons)}`;
}
