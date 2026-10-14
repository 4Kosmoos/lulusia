// Inventaire de l'usine : stock de chaque objet (conteneurs, dépôt dimensionnel) et rythmes de production.
// Partagé par /stock, /alerte et la surveillance des alertes perso.

import { formatDuration, formatInteger, formatNumber } from "../format.ts";
import { frm, type ItemAmount, type ProductionStat } from "../frm.ts";
import { cached, resolve, type Candidate } from "./shared.ts";

export interface Item {
  /** Identifiant stable du jeu (« Desc_IronPlate_C »). */
  className: string;
  name: string;
}

export interface Inventory {
  storage: ItemAmount[];
  depot: ItemAmount[];
  stats: ProductionStat[];
  /** Objets en stock, au dépôt ou dans une recette en cours, triés par nom. */
  items: Item[];
}

/** En dessous de cet écart (par minute), production et consommation sont considérées à l'équilibre. */
export const BALANCED = 0.05;

function listItems(...sources: { ClassName: string; Name: string }[][]): Item[] {
  const names = new Map<string, string>();
  for (const source of sources) {
    for (const { ClassName, Name } of source) if (Name) names.set(ClassName, Name);
  }
  return [...names]
    .map(([className, name]) => ({ className, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function loadInventory(): Promise<Inventory> {
  const [storage, depot, stats] = await Promise.all([
    frm.storageTotals(),
    frm.dimensionalDepot(),
    frm.productionStats(),
  ]);
  return { storage, depot, stats, items: listItems(storage, depot, stats) };
}

/** Pour l'autocomplétion : la liste des objets, gardée 1 min. */
export const knownItems = cached(async () => (await loadInventory()).items, 60_000);

export const itemCandidates = (items: Item[]): Candidate[] =>
  items.map((item) => ({ label: item.name, value: item.className, search: item.name }));

/** Retrouve l'objet choisi dans les suggestions, ou tapé à la main (nom exact ou seul nom qui contient le texte). */
export const findItem = (items: Item[], typed: string) =>
  resolve(items, typed, (i) => i.className, (i) => i.name);

export interface ItemReport {
  name: string;
  inStorage: number;
  inDepot: number;
  total: number;
  /** Unité des fluides (« m³ »), vide pour les objets. */
  unit: string;
  fluid: boolean;
  /** Rythmes, seulement si au moins une machine produit ou consomme l'objet. */
  stat?: ProductionStat;
  /** Production moins consommation, par minute (0 si aucune machine ne s'en sert). */
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

/** « stock vide dans ~2 h 05 » si le bilan est négatif et qu'il reste du stock, sinon chaîne vide. */
export function emptyInText(r: ItemReport): string {
  return r.balance < -BALANCED && r.total > 0 ? `stock vide dans ~${formatDuration(r.total / -r.balance)} à ce rythme` : "";
}

/** « prod 450/min (max 480/min), conso 300/min (max 320/min), bilan +150/min », en texte simple. */
export function ratesText(r: ItemReport): string {
  const { stat } = r;
  if (!stat) return "ni produit ni consommé en ce moment";
  const parts: string[] = [];
  if (stat.MaxProd > 0) parts.push(`prod ${perMinuteText(r, stat.CurrentProd)} (max ${perMinuteText(r, stat.MaxProd)})`);
  if (stat.MaxConsumed > 0) {
    parts.push(`conso ${perMinuteText(r, stat.CurrentConsumed)} (max ${perMinuteText(r, stat.MaxConsumed)})`);
  }
  if (Math.abs(r.balance) < BALANCED) parts.push("bilan équilibré");
  else if (r.balance > 0) parts.push(`bilan +${perMinuteText(r, r.balance)}`);
  else parts.push(`bilan -${perMinuteText(r, -r.balance)}`);
  const empty = emptyInText(r);
  if (empty) parts.push(empty);
  return parts.join(", ");
}
