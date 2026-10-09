// /stock <objet> : quantité d'un objet dans les stockages, et son rythme de production.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { formatDuration, formatInteger, formatNumber } from "../format.ts";
import { frm, type ItemAmount, type ProductionStat } from "../frm.ts";
import { cached, forAutocomplete, resolve, suggestions, type Command } from "./shared.ts";

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

function rateLines(stat: ProductionStat, stock: number, unit: string): { lines: string[]; deficit: boolean } {
  const perMinute = (value: number) => `${formatNumber(value)}${unit}/min`;
  const lines: string[] = [];
  if (stat.MaxProd > 0) lines.push(`Production : **${perMinute(stat.CurrentProd)}** (max ${perMinute(stat.MaxProd)})`);
  if (stat.MaxConsumed > 0) {
    lines.push(`Consommation : **${perMinute(stat.CurrentConsumed)}** (max ${perMinute(stat.MaxConsumed)})`);
  }

  const balance = stat.CurrentProd - stat.CurrentConsumed;
  if (Math.abs(balance) < 0.05) {
    lines.push("Bilan : ⚪ équilibré");
  } else if (balance > 0) {
    lines.push(`Bilan : 🟢 **+${perMinute(balance)}**`);
  } else {
    const emptyIn = stock > 0 ? `, stock vide dans ~${formatDuration(stock / -balance)} à ce rythme` : "";
    lines.push(`Bilan : 🔴 **−${perMinute(-balance)}**${emptyIn}`);
  }
  return { lines, deficit: balance <= -0.05 };
}

export const stock: Command = {
  data: new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Quantité d'un objet dans les stockages, et son rythme de production")
    .addStringOption((option) =>
      option.setName("objet").setDescription("L'objet à chercher").setRequired(true).setAutocomplete(true),
    )
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply();
    const typed = interaction.options.getString("objet", true);
    const { storage, depot, stats, items } = await loadAll();

    const { found, ambiguous } = resolve(items, typed, (i) => i.className, (i) => i.name);
    if (!found) {
      const reason =
        ambiguous.length > 0
          ? `plusieurs objets correspondent : ${ambiguous.map((n) => `**${escapeMarkdown(n)}**`).join(", ")}.`
          : "aucun objet de ce nom en stock ni en production.";
      await interaction.editReply(
        `❓ « ${escapeMarkdown(typed)} » : ${reason}\nChoisis l'objet dans la liste proposée pendant la saisie.`,
      );
      return;
    }

    const inStorage = total(storage, found.className);
    const inDepot = total(depot, found.className);
    const stat = stats.find((s) => s.ClassName === found.className);
    const fluid = stat?.Type === "Liquid" || stat?.Type === "Gas";
    const unit = fluid ? " m³" : "";

    const embed = new EmbedBuilder()
      .setTitle(`📦 ${found.name}`)
      .setFooter({ text: "Stock : conteneurs et dépôt dimensionnel. Rythmes : toutes les machines de l'usine." });

    // Un fluide non conditionné ne va pas en conteneur : inutile d'afficher un stock à 0.
    if (!fluid || inStorage + inDepot > 0) {
      const stockLines = [`Conteneurs : **${formatInteger(inStorage)}${unit}**`];
      if (inDepot > 0) stockLines.push(`Dépôt dimensionnel : **${formatInteger(inDepot)}${unit}**`);
      embed.addFields({ name: "Stock", value: stockLines.join("\n") });
    }

    if (stat && (stat.MaxProd > 0 || stat.MaxConsumed > 0)) {
      const { lines, deficit } = rateLines(stat, inStorage + inDepot, unit);
      embed.addFields({ name: "Rythme", value: lines.join("\n") }).setColor(deficit ? COLORS.deficit : COLORS.surplus);
    } else {
      embed.addFields({ name: "Rythme", value: "Ni produit ni consommé en ce moment." }).setColor(COLORS.idle);
    }
    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction) {
    const items = (await forAutocomplete(knownItems)) ?? [];
    const candidates = items.map((item) => ({ label: item.name, value: item.className, search: item.name }));
    await interaction.respond(suggestions(candidates, interaction.options.getFocused()));
  },
};
