// /stock <objet> : quantité d'un objet dans les stockages, et son rythme de production.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { formatDuration, formatInteger, formatNumber } from "../format.ts";
import { frm, type ItemAmount, type ProductionStat } from "../frm.ts";
import { cached, forAutocomplete, resolve, suggestions, type Command, type CommandResult } from "./shared.ts";

const COLORS = { surplus: 0x2ecc71, deficit: 0xe67e22, idle: 0x95a5a6 };

interface Item {
  className: string;
  name: string;
}

/** Objets cités par au moins une source, sans doublon (le ClassName est l'identifiant stable du jeu). */
function listItems(...sources: { ClassName: string; Name: string }[][]): Item[] {
  const names = new Map<string, string>();
  for (const source of sources) {
    for (const { ClassName, Name } of source) if (Name) names.set(ClassName, Name);
  }
  return [...names]
    .map(([className, name]) => ({ className, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function loadAll() {
  const [storage, depot, stats] = await Promise.all([
    frm.storageTotals(),
    frm.dimensionalDepot(),
    frm.productionStats(),
  ]);
  return { storage, depot, stats, items: listItems(storage, depot, stats) };
}

/** Pour l'autocomplétion : objets en stock, au dépôt ou dans une recette en cours, gardés 1 min. */
const knownItems = cached(async () => (await loadAll()).items, 60_000);

const total = (amounts: ItemAmount[], className: string) =>
  amounts.filter((a) => a.ClassName === className).reduce((sum, a) => sum + a.Amount, 0);

interface Report {
  name: string;
  inStorage: number;
  inDepot: number;
  /** Unité des fluides (« m³ »), vide pour les objets. */
  unit: string;
  /** Un fluide non conditionné ne va pas en conteneur : inutile d'afficher un stock à 0. */
  showStock: boolean;
  /** Rythmes, seulement si au moins une machine produit ou consomme l'objet. */
  stat?: ProductionStat;
  balance: number;
}

function buildReport(item: Item, storage: ItemAmount[], depot: ItemAmount[], stats: ProductionStat[]): Report {
  const inStorage = total(storage, item.className);
  const inDepot = total(depot, item.className);
  const stat = stats.find((s) => s.ClassName === item.className);
  const fluid = stat?.Type === "Liquid" || stat?.Type === "Gas";
  const active = stat !== undefined && (stat.MaxProd > 0 || stat.MaxConsumed > 0);
  return {
    name: item.name,
    inStorage,
    inDepot,
    unit: fluid ? " m³" : "",
    showStock: !fluid || inStorage + inDepot > 0,
    stat: active ? stat : undefined,
    balance: active ? stat.CurrentProd - stat.CurrentConsumed : 0,
  };
}

const BALANCED = 0.05;

/** « stock vide dans ~2 h 05 » si le bilan est négatif et qu'il reste du stock. */
function emptyIn(r: Report): string {
  const stock = r.inStorage + r.inDepot;
  return r.balance < -BALANCED && stock > 0 ? `, stock vide dans ~${formatDuration(stock / -r.balance)} à ce rythme` : "";
}

function toEmbed(r: Report): EmbedBuilder {
  const perMinute = (value: number) => `${formatNumber(value)}${r.unit}/min`;
  const embed = new EmbedBuilder()
    .setTitle(`📦 ${r.name}`)
    .setFooter({ text: "Stock : conteneurs et dépôt dimensionnel. Rythmes : toutes les machines de l'usine." });

  if (r.showStock) {
    const lines = [`Conteneurs : **${formatInteger(r.inStorage)}${r.unit}**`];
    if (r.inDepot > 0) lines.push(`Dépôt dimensionnel : **${formatInteger(r.inDepot)}${r.unit}**`);
    embed.addFields({ name: "Stock", value: lines.join("\n") });
  }

  const { stat } = r;
  if (!stat) {
    return embed.addFields({ name: "Rythme", value: "Ni produit ni consommé en ce moment." }).setColor(COLORS.idle);
  }
  const lines: string[] = [];
  if (stat.MaxProd > 0) lines.push(`Production : **${perMinute(stat.CurrentProd)}** (max ${perMinute(stat.MaxProd)})`);
  if (stat.MaxConsumed > 0) {
    lines.push(`Consommation : **${perMinute(stat.CurrentConsumed)}** (max ${perMinute(stat.MaxConsumed)})`);
  }
  if (Math.abs(r.balance) < BALANCED) lines.push("Bilan : ⚪ équilibré");
  else if (r.balance > 0) lines.push(`Bilan : 🟢 **+${perMinute(r.balance)}**`);
  else lines.push(`Bilan : 🔴 **−${perMinute(-r.balance)}**${emptyIn(r)}`);
  return embed
    .addFields({ name: "Rythme", value: lines.join("\n") })
    .setColor(r.balance < -BALANCED ? COLORS.deficit : COLORS.surplus);
}

function toGame(r: Report): string[] {
  const perMinute = (value: number) => `${formatNumber(value)}${r.unit}/min`;
  const { stat } = r;
  let rates = "ni produit ni consommé en ce moment";
  if (stat) {
    const parts: string[] = [];
    if (stat.MaxProd > 0) parts.push(`prod ${perMinute(stat.CurrentProd)} (max ${perMinute(stat.MaxProd)})`);
    if (stat.MaxConsumed > 0) parts.push(`conso ${perMinute(stat.CurrentConsumed)} (max ${perMinute(stat.MaxConsumed)})`);
    if (Math.abs(r.balance) < BALANCED) parts.push("bilan équilibré");
    else if (r.balance > 0) parts.push(`bilan +${perMinute(r.balance)}`);
    else parts.push(`bilan -${perMinute(-r.balance)}${emptyIn(r)}`);
    rates = parts.join(", ");
  }
  if (!r.showStock) return [`${r.name} : ${rates}`];

  const depot = r.inDepot > 0 ? ` (+ ${formatInteger(r.inDepot)}${r.unit} au dépôt dimensionnel)` : "";
  return [`${r.name} : ${formatInteger(r.inStorage)}${r.unit} en stock${depot}`, `${r.name} : ${rates}`];
}

function notFound(typed: string, ambiguous: string[]): CommandResult {
  if (ambiguous.length > 0) {
    return {
      discord: `❓ « ${escapeMarkdown(typed)} » : plusieurs objets correspondent : ${ambiguous.map((n) => `**${escapeMarkdown(n)}**`).join(", ")}.`,
      game: [`"${typed}" : plusieurs objets correspondent : ${ambiguous.join(", ")}. Précise le nom.`],
    };
  }
  return {
    discord: `❓ « ${escapeMarkdown(typed)} » : aucun objet de ce nom en stock ni en production.\nChoisis l'objet dans la liste proposée pendant la saisie.`,
    game: [`"${typed}" : aucun objet de ce nom en stock ni en production (noms du serveur, ex. !stock iron plate).`],
  };
}

export const stock: Command = {
  data: new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Quantité d'un objet dans les stockages, et son rythme de production")
    .addStringOption((option) =>
      option.setName("objet").setDescription("L'objet à chercher").setRequired(true).setAutocomplete(true),
    )
    .toJSON(),
  gameUsage: "!stock <objet>",

  async run({ options }) {
    const typed = options.objet ?? "";
    const { storage, depot, stats, items } = await loadAll();
    const { found, ambiguous } = resolve(items, typed, (i) => i.className, (i) => i.name);
    if (!found) return notFound(typed, ambiguous);

    const report = buildReport(found, storage, depot, stats);
    return { discord: toEmbed(report), game: toGame(report) };
  },

  async autocomplete(interaction) {
    const items = (await forAutocomplete(knownItems)) ?? [];
    const candidates = items.map((item) => ({ label: item.name, value: item.className, search: item.name }));
    await interaction.respond(suggestions(candidates, interaction.options.getFocused()));
  },
};
