// /alerte : créer, lister et supprimer les alertes perso (stock bas, bilan négatif).
// Dans le jeu : !alerte stock iron plate 1000, !alerte bilan iron ingot, !alertes, !alerte supprimer 2.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { currentText, listRules, removeRule, ruleText, upsertRule, type AlertKind, type AlertRule } from "../alerts.ts";
import { formatInteger, normalize } from "../format.ts";
import { findItem, itemCandidates, knownItems, loadInventory, reportFor, type Inventory } from "./inventory.ts";
import { forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";
import { itemNotFound } from "./stock.ts";

const MAX_LISTED_IN_GAME = 10;

/** « 1000 », « 1 000 », « 1.000 » → 1000. */
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
      ? `prévenir quand le stock de ${rule.name} passe sous ${formatInteger(threshold ?? 0)}`
      : `prévenir quand ${rule.name} est consommé plus vite que produit pendant 10 min`;
  const verb = updated ? "mise à jour" : "créée";
  const now = currentText(rule, report);
  return {
    discord: `🔔 Alerte n°${rule.id} ${verb} : ${escapeMarkdown(what)}.\nEn ce moment : ${escapeMarkdown(now)}.`,
    game: [`Alerte n°${rule.id} ${verb} : ${what}. En ce moment : ${now}.`],
  };
}

async function list(): Promise<CommandResult> {
  const rules = await listRules();
  if (rules.length === 0) {
    const help = "Aucune alerte perso. Pour en créer : /alerte stock ou /alerte bilan (dans le jeu : !alerte stock iron plate 1000).";
    return { discord: `🔔 ${help}`, game: [help] };
  }

  let inventory: Inventory | undefined;
  try {
    inventory = await loadInventory();
  } catch {
    inventory = undefined; // FRM en panne : on liste quand même les alertes, sans les valeurs actuelles
  }
  const line = (rule: AlertRule) => {
    const now = inventory ? ` (en ce moment : ${currentText(rule, reportFor(inventory, rule))})` : "";
    return `n°${rule.id} · ${ruleText(rule)}${now}`;
  };

  const embed = new EmbedBuilder()
    .setTitle(`🔔 Alertes perso (${rules.length})`)
    .setDescription(rules.map((rule) => escapeMarkdown(line(rule))).join("\n"))
    .setFooter({ text: "Supprimer : /alerte supprimer, ou !alerte supprimer <n°> dans le jeu" });
  const game = rules.slice(0, MAX_LISTED_IN_GAME).map(line);
  if (rules.length > MAX_LISTED_IN_GAME) game.push(`+ ${rules.length - MAX_LISTED_IN_GAME} autres (liste complète sur Discord : /alerte liste)`);
  return { discord: embed, game };
}

async function remove(typed: string | undefined): Promise<CommandResult> {
  const id = Number(typed?.replace(/^n°/i, ""));
  const rule = Number.isInteger(id) ? await removeRule(id) : undefined;
  if (!rule) {
    const text = `Aucune alerte n°${typed ?? "?"}. Voir la liste : /alerte liste (ou !alertes dans le jeu).`;
    return { discord: `❓ ${text}`, game: [text] };
  }
  const text = `Alerte n°${rule.id} supprimée : ${ruleText(rule)}.`;
  return { discord: `🔕 ${escapeMarkdown(text)}`, game: [text] };
}

export const alerte: Command = {
  data: new SlashCommandBuilder()
    .setName("alerte")
    .setDescription("Alertes perso sur les stocks et la production, envoyées dans #alertes et dans le jeu")
    .addSubcommand((sub) =>
      sub
        .setName("stock")
        .setDescription("Prévenir quand le stock d'un objet passe sous un seuil")
        .addStringOption((option) =>
          option.setName("objet").setDescription("L'objet à surveiller").setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((option) =>
          option.setName("sous").setDescription("Seuil : alerte quand le stock passe en dessous").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("bilan")
        .setDescription("Prévenir quand un objet est consommé plus vite que produit pendant 10 min")
        .addStringOption((option) =>
          option.setName("objet").setDescription("L'objet à surveiller").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("liste").setDescription("Voir les alertes perso et l'état actuel de chaque objet"))
    .addSubcommand((sub) =>
      sub
        .setName("supprimer")
        .setDescription("Supprimer une alerte perso")
        .addIntegerOption((option) =>
          option.setName("numero").setDescription("Numéro de l'alerte").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!alerte stock <objet> <seuil> | !alerte bilan <objet> | !alertes | !alerte supprimer <n°>",

  parseGame(text): CommandArgs | undefined {
    const [first = "", ...rest] = text.trim().split(/\s+/).filter(Boolean);
    const sub = normalize(first);
    if (sub === "" || sub === "liste") return { subcommand: "liste", options: {} };
    if (sub === "supprimer") return rest.length === 1 ? { subcommand: "supprimer", options: { numero: rest[0] } } : undefined;
    if (sub === "bilan") return rest.length > 0 ? { subcommand: "bilan", options: { objet: rest.join(" ") } } : undefined;
    if (sub === "stock") {
      // Le seuil est à la fin : « !alerte stock iron plate 1000 » ou « … 1 000 ».
      const match = /^(.*?\S)\s+(\d{1,3}(?:[ .,]\d{3})+|\d+)$/.exec(rest.join(" "));
      if (!match) return undefined;
      return { subcommand: "stock", options: { objet: match[1], sous: match[2] } };
    }
    return undefined;
  },

  async run({ subcommand, options, author }) {
    switch (subcommand) {
      case "stock": {
        const threshold = parseThreshold(options.sous);
        if (threshold === undefined) {
          const text = "Seuil invalide : un nombre entier, par exemple 1000.";
          return { discord: `❓ ${text}`, game: [text] };
        }
        return create("stock", options.objet ?? "", threshold, author);
      }
      case "bilan":
        return create("bilan", options.objet ?? "", undefined, author);
      case "supprimer":
        return remove(options.numero);
      default:
        return list();
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "numero") {
      const rules = await listRules();
      const typed = String(focused.value);
      await interaction.respond(
        rules
          .filter((rule) => !typed || String(rule.id).startsWith(typed) || normalize(ruleText(rule)).includes(normalize(typed)))
          .slice(0, 25)
          .map((rule) => ({ name: `n°${rule.id} · ${ruleText(rule)}`.slice(0, 100), value: rule.id })),
      );
      return;
    }
    const items = (await forAutocomplete(knownItems)) ?? [];
    await interaction.respond(suggestions(itemCandidates(items), String(focused.value)));
  },
};
