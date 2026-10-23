// /alert: create, list and remove custom alerts (low stock, deficit).
// In game: !alert stock iron plate 1000, !alert deficit iron ingot, !alerts, !alert remove 2.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { formatInteger } from "@lulusia/lib/format";
import { findItem, reportFor, type Inventory } from "@lulusia/lib/inventory";
import { normalize } from "@lulusia/lib/search";
import { currentText, listRules, removeRule, ruleText, upsertRule, type AlertKind, type AlertRule } from "../alerts.ts";
import { itemCandidates, knownItems, loadInventory } from "./inventory.ts";
import { forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";
import { itemNotFound } from "./stock.ts";

const MAX_LISTED_IN_GAME = 10;

/** "1000", "1,000", "1 000" → 1000. */
function parseThreshold(text: string | undefined): number | undefined {
  const digits = text?.replace(/[\s.,_]/g, "");
  if (!digits || !/^\d+$/.test(digits)) return undefined;
  const value = Number(digits);
  return value >= 1 ? value : undefined;
}

async function create(kind: AlertKind, typed: string, threshold: number | undefined, author: string): Promise<CommandResult> {
  const inventory = await loadInventory();
  const { found, ambiguous } = findItem(inventory.items, typed);
  if (!found) return itemNotFound(typed, ambiguous);

  const { rule, updated } = await upsertRule(kind, found, threshold, author);
  const report = reportFor(inventory, found);
  const what =
    kind === "stock"
      ? `warn when the ${rule.name} stock drops below ${formatInteger(threshold ?? 0)}`
      : `warn when ${rule.name} is consumed faster than produced for 10 min`;
  const verb = updated ? "updated" : "created";
  const now = currentText(rule, report);
  return {
    discord: `🔔 Alert #${rule.id} ${verb}: ${escapeMarkdown(what)}.\nRight now: ${escapeMarkdown(now)}.`,
    game: [`Alert #${rule.id} ${verb}: ${what}. Right now: ${now}.`],
  };
}

async function list(): Promise<CommandResult> {
  const rules = await listRules();
  if (rules.length === 0) {
    const help = "No custom alerts. To create one: /alert stock or /alert deficit (in game: !alert stock iron plate 1000).";
    return { discord: `🔔 ${help}`, game: [help] };
  }

  let inventory: Inventory | undefined;
  try {
    inventory = await loadInventory();
  } catch {
    inventory = undefined; // FRM down: list the alerts anyway, without the current values
  }
  const line = (rule: AlertRule) => {
    const now = inventory ? ` (now: ${currentText(rule, reportFor(inventory, rule))})` : "";
    return `#${rule.id} · ${ruleText(rule)}${now}`;
  };

  const embed = new EmbedBuilder()
    .setTitle(`🔔 Custom alerts (${rules.length})`)
    .setDescription(rules.map((rule) => escapeMarkdown(line(rule))).join("\n"))
    .setFooter({ text: "Remove: /alert remove, or !alert remove <number> in game" });
  const game = rules.slice(0, MAX_LISTED_IN_GAME).map(line);
  if (rules.length > MAX_LISTED_IN_GAME) game.push(`+ ${rules.length - MAX_LISTED_IN_GAME} more (full list on Discord: /alert list)`);
  return { discord: embed, game };
}

async function remove(typed: string | undefined): Promise<CommandResult> {
  const id = Number(typed?.replace(/^#/, ""));
  const rule = Number.isInteger(id) ? await removeRule(id) : undefined;
  if (!rule) {
    const text = `No alert #${typed?.replace(/^#/, "") ?? "?"}. See the list: /alert list (or !alerts in game).`;
    return { discord: `❓ ${text}`, game: [text] };
  }
  const text = `Alert #${rule.id} removed: ${ruleText(rule)}.`;
  return { discord: `🔕 ${escapeMarkdown(text)}`, game: [text] };
}

export const alert: Command = {
  data: new SlashCommandBuilder()
    .setName("alert")
    .setDescription("Custom alerts on stock and production, sent to #alertes and to the game chat")
    .addSubcommand((sub) =>
      sub
        .setName("stock")
        .setDescription("Warn when the stock of an item drops below a threshold")
        .addStringOption((option) =>
          option.setName("item").setDescription("The item to watch").setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((option) =>
          option.setName("below").setDescription("Threshold: alert when the stock drops below it").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("deficit")
        .setDescription("Warn when an item is consumed faster than produced for 10 min")
        .addStringOption((option) =>
          option.setName("item").setDescription("The item to watch").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("See the custom alerts and the current state of each item"))
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a custom alert")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Number of the alert").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!alert stock <item> <threshold> | !alert deficit <item> | !alerts | !alert remove <number>",

  parseGame(text): CommandArgs | undefined {
    const [first = "", ...rest] = text.trim().split(/\s+/).filter(Boolean);
    const sub = normalize(first);
    if (sub === "" || sub === "list") return { subcommand: "list", options: {} };
    if (sub === "remove") return rest.length === 1 ? { subcommand: "remove", options: { number: rest[0] } } : undefined;
    if (sub === "deficit") return rest.length > 0 ? { subcommand: "deficit", options: { item: rest.join(" ") } } : undefined;
    if (sub === "stock") {
      // The threshold is at the end: "!alert stock iron plate 1000" or "… 1,000".
      const match = /^(.*?\S)\s+(\d{1,3}(?:[ .,]\d{3})+|\d+)$/.exec(rest.join(" "));
      if (!match) return undefined;
      return { subcommand: "stock", options: { item: match[1], below: match[2] } };
    }
    return undefined;
  },

  async run({ subcommand, options, author }) {
    switch (subcommand) {
      case "stock": {
        const threshold = parseThreshold(options.below);
        if (threshold === undefined) {
          const text = "Invalid threshold: a whole number, for example 1000.";
          return { discord: `❓ ${text}`, game: [text] };
        }
        return create("stock", options.item ?? "", threshold, author);
      }
      case "deficit":
        return create("deficit", options.item ?? "", undefined, author);
      case "remove":
        return remove(options.number);
      default:
        return list();
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "number") {
      const rules = await listRules();
      const typed = String(focused.value);
      await interaction.respond(
        rules
          .filter((rule) => !typed || String(rule.id).startsWith(typed) || normalize(ruleText(rule)).includes(normalize(typed)))
          .slice(0, 25)
          .map((rule) => ({ name: `#${rule.id} · ${ruleText(rule)}`.slice(0, 100), value: rule.id })),
      );
      return;
    }
    const items = (await forAutocomplete(knownItems)) ?? [];
    await interaction.respond(suggestions(itemCandidates(items), String(focused.value)));
  },
};
