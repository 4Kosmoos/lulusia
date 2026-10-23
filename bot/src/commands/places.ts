// Named places of the game (HUB, train stations, map markers, players), for /players, /ping and /switch.

import { cached } from "@lulusia/lib/cache";
import { formatNumber } from "@lulusia/lib/format";
import type { Location, Player } from "@lulusia/lib/frm";
import { frm } from "../frm.ts";
import type { Candidate } from "./shared.ts";

export type PlaceKind = "hub" | "station" | "marker" | "player";

export interface Place {
  /** Stable identifier, used as the value in autocomplete. */
  key: string;
  kind: PlaceKind;
  name: string;
  location: Location;
}

const ICONS: Record<PlaceKind, string> = { hub: "🏠", station: "🚉", marker: "🚩", player: "👷" };
const KIND_ORDER: PlaceKind[] = ["hub", "station", "marker", "player"];

export const placeLabel = (place: Place): string => `${ICONS[place.kind]} ${place.name}`;

/** HUB, train stations and map markers, read right now. */
export async function loadNamedPlaces(): Promise<Place[]> {
  const [hubs, stations, markers] = await Promise.all([frm.hubTerminals(), frm.trainStations(), frm.mapMarkers()]);
  return [
    ...hubs.map((h): Place => ({ key: `hub:${h.ID}`, kind: "hub", name: "HUB", location: h.location })),
    ...stations.map((s): Place => ({ key: `station:${s.ID}`, kind: "station", name: s.Name || "Unnamed station", location: s.location })),
    ...markers.map((m): Place => ({ key: `marker:${m.ID}`, kind: "marker", name: m.Name || m.Category || "Unnamed marker", location: m.location })),
  ];
}

/** For autocomplete: named places kept for 30 s, players kept for 5 s. */
export const cachedNamedPlaces = cached(loadNamedPlaces, 30_000);
export const cachedPlayers = cached(() => frm.players(), 5_000);

export function playerPlaces(players: Player[]): Place[] {
  return players
    .filter((p) => p.Online)
    .map((p): Place => ({ key: `player:${p.ID}`, kind: "player", name: p.Name || "Unnamed pioneer", location: p.location }));
}

export function placeCandidates(places: Place[]): Candidate[] {
  return [...places]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "en"))
    .map((place) => ({
      label: place.kind === "player" ? `${placeLabel(place)} (player)` : placeLabel(place),
      value: place.key,
      search: place.name,
    }));
}

/** Ground distance, in meters (game coordinates are in centimeters). */
function groundDistance(from: Location, to: Location): number {
  return Math.hypot(to.x - from.x, to.y - from.y) / 100;
}

const DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Direction of `to` seen from `from`. In the game, x goes east and y goes south. */
function direction(from: Location, to: Location): string {
  const degrees = (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI;
  return DIRECTIONS[Math.round(((degrees + 360) % 360) / 45) % 8];
}

function distanceText(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${formatNumber(meters / 1000)} km`;
}

/** "Iron Station", "the HUB" (with the place's icon if `icons`). */
function placeName(place: Place, icons: boolean): string {
  const label = icons ? placeLabel(place) : place.name;
  return place.kind === "hub" ? `the ${label}` : label;
}

/** "350 m north-east of 🚉 Iron Station", from the nearest named place. */
export function whereIs(location: Location, places: Place[], icons = true): string {
  if (places.length === 0) return "unknown position (no named place)";
  const nearest = places.reduce((best, place) =>
    groundDistance(location, place.location) < groundDistance(location, best.location) ? place : best,
  );
  const meters = groundDistance(nearest.location, location);
  if (meters < 50) return `at ${placeName(nearest, icons)}`;
  return `${distanceText(meters)} ${direction(nearest.location, location)} of ${placeName(nearest, icons)}`;
}
