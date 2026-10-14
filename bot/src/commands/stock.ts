// /stock <objet> : quantité d'un objet dans les stockages, et son rythme de production.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import {
  BALANCED,
  amountText,
  emptyInText,
  findItem,
  itemCandidates,
  knownItems,
  loadInventory,
  perMinuteText,
  ratesText,
  reportFor,
  type ItemReport,
} from "./inventory.ts";
import { forAutocomplete, suggestions, type Command, type CommandResult } from "./shared.ts";

const COLORS = { surplus: 0x2ecc71, deficit: 0xe67e22, idle: 0x95a5a6 };

function toEmbed(r: ItemReport): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📦 ${r.name}`)
    .setFooter({ text: "Stock : conteneurs et dépôt dimensionnel. Rythmes : toutes les machines de l'usine." });

  // Un fluide non conditionné ne va pas en conteneur : inutile d'afficher un stock à 0.
  if (!r.fluid || r.total > 0) {
    const lines = [`Conteneurs : **${amountText(r, r.inStorage)}**`];
    if (r.inDepot > 0) lines.push(`Dépôt dimensionnel : **${amountText(r, r.inDepot)}**`);
    embed.addFields({ name: "Stock", value: lines.join("\n") });
  }

  const { stat } = r;
  if (!stat) {
    return embed.addFields({ name: "Rythme", value: "Ni produit ni consommé en ce moment." }).setColor(COLORS.idle);
  }
  const lines: string[] = [];
  if (stat.MaxProd > 0) {
    lines.push(`Production : **${perMinuteText(r, stat.CurrentProd)}** (max ${perMinuteText(r, stat.MaxProd)})`);
  }
  if (stat.MaxConsumed > 0) {
    lines.push(`Consommation : **${perMinuteText(r, stat.CurrentConsumed)}** (max ${perMinuteText(r, stat.MaxConsumed)})`);
  }
  const empty = emptyInText(r);
  if (Math.abs(r.balance) < BALANCED) lines.push("Bilan : ⚪ équilibré");
  else if (r.balance > 0) lines.push(`Bilan : 🟢 **+${perMinuteText(r, r.balance)}**`);
  else lines.push(`Bilan : 🔴 **−${perMinuteText(r, -r.balance)}**${empty ? `, ${empty}` : ""}`);
  return embed
    .addFields({ name: "Rythme", value: lines.join("\n") })
    .setColor(r.balance < -BALANCED ? COLORS.deficit : COLORS.surplus);
}

function toGame(r: ItemReport): string[] {
  const rates = `${r.name} : ${ratesText(r)}`;
  if (r.fluid && r.total === 0) return [rates];
  const depot = r.inDepot > 0 ? ` (+ ${amountText(r, r.inDepot)} au dépôt dimensionnel)` : "";
  return [`${r.name} : ${amountText(r, r.inStorage)} en stock${depot}`, rates];
}

/** Réponse quand l'objet tapé n'est pas trouvé ou est ambigu (partagée avec /alerte). */
export function itemNotFound(typed: string, ambiguous: string[]): CommandResult {
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
    const inventory = await loadInventory();
    const { found, ambiguous } = findItem(inventory.items, typed);
    if (!found) return itemNotFound(typed, ambiguous);

    const report = reportFor(inventory, found);
    return { discord: toEmbed(report), game: toGame(report) };
  },

  async autocomplete(interaction) {
    const items = (await forAutocomplete(knownItems)) ?? [];
    await interaction.respond(suggestions(itemCandidates(items), interaction.options.getFocused()));
  },
};
