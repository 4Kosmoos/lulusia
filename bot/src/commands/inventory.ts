// Factory inventory for the bot: loading with the bot's client, suggestions and text of the rates.
// Shared by /stock, /alert and the custom alert watcher. The computations are in @lulusia/lib/inventory.

import { cached } from "@lulusia/lib/cache";
import { formatDuration, formatInteger, formatNumber } from "@lulusia/lib/format";
import {
  BALANCED,
  loadInventory as loadInventoryFrom,
  minutesUntilEmpty,
  type Inventory,
  type Item,
  type ItemReport,
} from "@lulusia/lib/inventory";
import { frm } from "../frm.ts";
import type { Candidate } from "./shared.ts";

export const loadInventory = (): Promise<Inventory> => loadInventoryFrom(frm);

/** For autocomplete: the list of items, kept for 1 min. */
export const knownItems = cached(async () => (await loadInventory()).items, 60_000);

export const itemCandidates = (items: Item[]): Candidate[] =>
  items.map((item) => ({ label: item.name, value: item.className, search: item.name }));

export const amountText = (r: ItemReport, value: number) => `${formatInteger(value)}${r.unit}`;
export const perMinuteText = (r: ItemReport, value: number) => `${formatNumber(value)}${r.unit}/min`;

/** "empty in ~2h 05m at this rate" if the balance is negative and there is stock left, otherwise "". */
export function emptyInText(r: ItemReport): string {
  const minutes = minutesUntilEmpty(r);
  return minutes === undefined ? "" : `empty in ~${formatDuration(minutes)} at this rate`;
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
