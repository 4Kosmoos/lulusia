// Factory inventory: stock of each item (containers, dimensional depot) and production rates.
// Shared by /stock, /alert and the custom alert watcher.

import { formatDuration, formatInteger, formatNumber } from "../format.ts";
import { frm, type ItemAmount, type ProductionStat } from "../frm.ts";
import { cached, resolve, type Candidate } from "./shared.ts";

export interface Item {
  /** Stable game identifier ("Desc_IronPlate_C"). */
  className: string;
  name: string;
}

export interface Inventory {
  storage: ItemAmount[];
  depot: ItemAmount[];
  stats: ProductionStat[];
  /** Items in stock, in the depot or in a running recipe, sorted by name. */
  items: Item[];
}

/** Below this difference (per minute), production and consumption are considered balanced. */
export const BALANCED = 0.05;

function listItems(...sources: { ClassName: string; Name: string }[][]): Item[] {
  const names = new Map<string, string>();
  for (const source of sources) {
    for (const { ClassName, Name } of source) if (Name) names.set(ClassName, Name);
  }
  return [...names]
    .map(([className, name]) => ({ className, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export async function loadInventory(): Promise<Inventory> {
  const [storage, depot, stats] = await Promise.all([
    frm.storageTotals(),
    frm.dimensionalDepot(),
    frm.productionStats(),
  ]);
  return { storage, depot, stats, items: listItems(storage, depot, stats) };
}

/** For autocomplete: the list of items, kept for 1 min. */
export const knownItems = cached(async () => (await loadInventory()).items, 60_000);

export const itemCandidates = (items: Item[]): Candidate[] =>
  items.map((item) => ({ label: item.name, value: item.className, search: item.name }));

/** Finds the item picked in the suggestions, or typed by hand (exact name, or the only name containing the text). */
export const findItem = (items: Item[], typed: string) =>
  resolve(items, typed, (i) => i.className, (i) => i.name);

export interface ItemReport {
  name: string;
  inStorage: number;
  inDepot: number;
  total: number;
  /** Unit of fluids (" m³"), empty for items. */
  unit: string;
  fluid: boolean;
  /** Rates, only if at least one machine produces or consumes the item. */
  stat?: ProductionStat;
  /** Production minus consumption, per minute (0 if no machine uses it). */
  balance: number;
}

export function reportFor(inventory: Inventory, item: Item): ItemReport {
  const total = (amounts: ItemAmount[]) =>
    amounts.filter((a) => a.ClassName === item.className).reduce((sum, a) => sum + a.Amount, 0);
  const inStorage = total(inventory.storage);
  const inDepot = total(inventory.depot);
  const stat = inventory.stats.find((s) => s.ClassName === item.className);
  const fluid = stat?.Type === "Liquid" || stat?.Type === "Gas";
  const active = stat !== undefined && (stat.MaxProd > 0 || stat.MaxConsumed > 0);
  return {
    name: inventory.items.find((i) => i.className === item.className)?.name ?? item.name,
    inStorage,
    inDepot,
    total: inStorage + inDepot,
    unit: fluid ? " m³" : "",
    fluid,
    stat: active ? stat : undefined,
    balance: active ? stat.CurrentProd - stat.CurrentConsumed : 0,
  };
}

export const amountText = (r: ItemReport, value: number) => `${formatInteger(value)}${r.unit}`;
export const perMinuteText = (r: ItemReport, value: number) => `${formatNumber(value)}${r.unit}/min`;

/** "empty in ~2h 05m at this rate" if the balance is negative and there is stock left, otherwise "". */
export function emptyInText(r: ItemReport): string {
  return r.balance < -BALANCED && r.total > 0 ? `empty in ~${formatDuration(r.total / -r.balance)} at this rate` : "";
}

/** "prod 450/min (max 480/min), cons 300/min (max 320/min), net +150/min", as plain text. */
export function ratesText(r: ItemReport): string {
  const { stat } = r;
  if (!stat) return "not produced or consumed right now";
  const parts: string[] = [];
  if (stat.MaxProd > 0) parts.push(`prod ${perMinuteText(r, stat.CurrentProd)} (max ${perMinuteText(r, stat.MaxProd)})`);
  if (stat.MaxConsumed > 0) {
    parts.push(`cons ${perMinuteText(r, stat.CurrentConsumed)} (max ${perMinuteText(r, stat.MaxConsumed)})`);
  }
  if (Math.abs(r.balance) < BALANCED) parts.push("balanced");
  else if (r.balance > 0) parts.push(`net +${perMinuteText(r, r.balance)}`);
  else parts.push(`net -${perMinuteText(r, -r.balance)}`);
  const empty = emptyInText(r);
  if (empty) parts.push(empty);
  return parts.join(", ");
}
