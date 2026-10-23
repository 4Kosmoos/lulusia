// /stock <item>: amount of an item in storage, and its production rate.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { BALANCED, findItem, reportFor, type ItemReport } from "@lulusia/lib/inventory";
import {
  amountText,
  emptyInText,
  itemCandidates,
  knownItems,
  loadInventory,
  perMinuteText,
  ratesText,
} from "./inventory.ts";
import { forAutocomplete, suggestions, type Command, type CommandResult } from "./shared.ts";

const COLORS = { surplus: 0x2ecc71, deficit: 0xe67e22, idle: 0x95a5a6 };

function toEmbed(r: ItemReport): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📦 ${r.name}`)
    .setFooter({ text: "Stock: containers and dimensional depot. Rates: every machine in the factory." });

  // An unpackaged fluid does not go into containers: no point showing a stock of 0.
  if (!r.fluid || r.total > 0) {
    const lines = [`Containers: **${amountText(r, r.inStorage)}**`];
    if (r.inDepot > 0) lines.push(`Dimensional depot: **${amountText(r, r.inDepot)}**`);
    embed.addFields({ name: "Stock", value: lines.join("\n") });
  }

  const { stat } = r;
  if (!stat) {
    return embed.addFields({ name: "Rates", value: "Not produced or consumed right now." }).setColor(COLORS.idle);
  }
  const lines: string[] = [];
  if (stat.MaxProd > 0) {
    lines.push(`Production: **${perMinuteText(r, stat.CurrentProd)}** (max ${perMinuteText(r, stat.MaxProd)})`);
  }
  if (stat.MaxConsumed > 0) {
    lines.push(`Consumption: **${perMinuteText(r, stat.CurrentConsumed)}** (max ${perMinuteText(r, stat.MaxConsumed)})`);
  }
  const empty = emptyInText(r);
  if (Math.abs(r.balance) < BALANCED) lines.push("Net: ⚪ balanced");
  else if (r.balance > 0) lines.push(`Net: 🟢 **+${perMinuteText(r, r.balance)}**`);
  else lines.push(`Net: 🔴 **−${perMinuteText(r, -r.balance)}**${empty ? `, ${empty}` : ""}`);
  return embed
    .addFields({ name: "Rates", value: lines.join("\n") })
    .setColor(r.balance < -BALANCED ? COLORS.deficit : COLORS.surplus);
}

function toGame(r: ItemReport): string[] {
  const rates = `${r.name}: ${ratesText(r)}`;
  if (r.fluid && r.total === 0) return [rates];
  const depot = r.inDepot > 0 ? ` (+ ${amountText(r, r.inDepot)} in the dimensional depot)` : "";
  return [`${r.name}: ${amountText(r, r.inStorage)} in stock${depot}`, rates];
}

/** Answer when the item typed is not found or is ambiguous (shared with /alert). */
export function itemNotFound(typed: string, ambiguous: string[]): CommandResult {
  if (ambiguous.length > 0) {
    return {
      discord: `❓ "${escapeMarkdown(typed)}": several items match: ${ambiguous.map((n) => `**${escapeMarkdown(n)}**`).join(", ")}.`,
      game: [`"${typed}": several items match: ${ambiguous.join(", ")}. Be more specific.`],
    };
  }
  return {
    discord: `❓ "${escapeMarkdown(typed)}": no item with this name in storage or in production.\nPick the item from the list shown while typing.`,
    game: [`"${typed}": no item with this name in storage or in production (e.g. !stock iron plate).`],
  };
}

export const stock: Command = {
  data: new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Amount of an item in storage, and its production rate")
    .addStringOption((option) =>
      option.setName("item").setDescription("The item to look up").setRequired(true).setAutocomplete(true),
    )
    .toJSON(),
  gameUsage: "!stock <item>",

  async run({ options }) {
    const typed = options.item ?? "";
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
