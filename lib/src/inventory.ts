// Factory inventory: stock of each item (containers, dimensional depot) and production rates.

import type { FrmReader, ItemAmount, ProductionStat } from "./frm.ts";
import { resolve } from "./search.ts";

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

export async function loadInventory(
  frm: Pick<FrmReader, "storageTotals" | "dimensionalDepot" | "productionStats">,
): Promise<Inventory> {
  const [storage, depot, stats] = await Promise.all([
    frm.storageTotals(),
    frm.dimensionalDepot(),
    frm.productionStats(),
  ]);
  return { storage, depot, stats, items: listItems(storage, depot, stats) };
}

/** Finds an item by identifier, or by the name typed (exact name, or the only name containing the text). */
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

/** Minutes before the stock runs out at the current rate, or undefined if it is not going down (or already empty). */
export function minutesUntilEmpty(r: ItemReport): number | undefined {
  return r.balance < -BALANCED && r.total > 0 ? r.total / -r.balance : undefined;
}
