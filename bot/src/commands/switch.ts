// /switch: turn the factory's power switches on or off, by the name they are given in game.
// Switches with the same name are controlled together.
// In game: !switch iron factory off, !switches.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { normalize, plural } from "../format.ts";
import { frm, type PowerSwitch } from "../frm.ts";
import { cachedNamedPlaces, whereIs, type Place } from "./places.ts";
import { cached, forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";

const COLORS = { on: 0x2ecc71, off: 0xe74c3c, mixed: 0xf1c40f };
const MAX_LISTED_IN_GAME = 10;
const ACTIONS: Record<string, "on" | "off"> = { on: "on", off: "off" };

interface SwitchGroup {
  /** "name:<name>" for a named group, "id:<ID>" for a switch without a name. */
  key: string;
  name: string;
  named: boolean;
  switches: PowerSwitch[];
}

const switchCount = (count: number) => plural(count, "switch", "switches");

function groupSwitches(switches: PowerSwitch[], places: Place[]): SwitchGroup[] {
  const groups = new Map<string, SwitchGroup>();
  for (const s of switches) {
    const tag = s.SwitchTag.trim();
    const key = tag ? `name:${normalize(tag)}` : `id:${s.ID}`;
    const group = groups.get(key) ?? {
      key,
      name: tag || `Unnamed, ${whereIs(s.location, places, false)}`,
      named: Boolean(tag),
      switches: [],
    };
    group.switches.push(s);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.named) - Number(a.named) || a.name.localeCompare(b.name, "en"));
}

async function loadGroups(): Promise<SwitchGroup[]> {
  const [switches, places] = await Promise.all([frm.switches(), cachedNamedPlaces()]);
  return groupSwitches(switches, places);
}
const cachedGroups = cached(loadGroups, 10_000);

function state(group: SwitchGroup): { icon: string; text: string; color: number } {
  const on = group.switches.filter((s) => s.IsOn).length;
  if (on === group.switches.length) return { icon: "🟢", text: "on", color: COLORS.on };
  if (on === 0) return { icon: "🔴", text: "off", color: COLORS.off };
  return { icon: "🟡", text: `${on}/${group.switches.length} on`, color: COLORS.mixed };
}

function details(group: SwitchGroup): string {
  const parts: string[] = [];
  if (group.switches.length > 1) parts.push(switchCount(group.switches.length));
  const priorities = [...new Set(group.switches.filter((s) => s.Priority >= 0).map((s) => s.Priority))];
  if (priorities.length > 0) parts.push(`priority ${priorities.join(", ")}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** The group picked in the suggestions, or typed by hand: exact name, otherwise the only name containing the text. */
function findGroup(groups: SwitchGroup[], typed: string): { found?: SwitchGroup; ambiguous: string[] } {
  const byKey = groups.find((g) => g.key === typed);
  if (byKey) return { found: byKey, ambiguous: [] };
  const query = normalize(typed);
  const named = groups.filter((g) => g.named);
  const exact = named.find((g) => normalize(g.name) === query);
  if (exact) return { found: exact, ambiguous: [] };
  const partial = query ? named.filter((g) => normalize(g.name).includes(query)) : [];
  if (partial.length === 1) return { found: partial[0], ambiguous: [] };
  return { ambiguous: partial.map((g) => g.name).slice(0, 10) };
}

async function list(): Promise<CommandResult> {
  const groups = await loadGroups();
  if (groups.length === 0) {
    const text = "No power switch in the factory.";
    return { discord: `⚡ ${text}`, game: [text] };
  }
  const lines = groups.map((g) => `${state(g).icon} **${escapeMarkdown(g.name)}**: ${state(g).text}${details(g)}`);
  const unnamed = groups.filter((g) => !g.named).length;
  const embed = new EmbedBuilder()
    .setTitle(`⚡ Switches (${groups.reduce((n, g) => n + g.switches.length, 0)})`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: unnamed > 0
        ? "Tip: name your switches in game to control them more easily."
        : "Switches with the same name are controlled together.",
    });
  const game = groups.slice(0, MAX_LISTED_IN_GAME).map((g) => `${g.name}: ${state(g).text}${details(g)}`);
  if (groups.length > MAX_LISTED_IN_GAME) game.push(`+ ${groups.length - MAX_LISTED_IN_GAME} more (full list on Discord: /switch list)`);
  return { discord: embed, game };
}

async function toggle(typed: string, on: boolean, author: string): Promise<CommandResult> {
  const groups = await loadGroups();
  const { found, ambiguous } = findGroup(groups, typed);
  if (!found) {
    const reason =
      ambiguous.length > 0
        ? `several switches match: ${ambiguous.join(", ")}`
        : "no switch with this name (see the list: /switch list or !switches)";
    return { discord: `❓ "${escapeMarkdown(typed)}": ${escapeMarkdown(reason)}.`, game: [`"${typed}": ${reason}.`] };
  }

  const verb = on ? "turned on" : "turned off";
  const label = `"${found.name}"`;
  const targets = found.switches.filter((s) => s.IsOn !== on).map((s) => s.ID);
  if (targets.length === 0) {
    const text = `Switch ${label} is already ${on ? "on" : "off"}.`;
    return { discord: `${on ? "🟢" : "🔴"} ${escapeMarkdown(text)}`, game: [text] };
  }

  const { changed, failed } = await frm.setSwitches(targets, on);
  const count = found.switches.length > 1 ? ` (${changed.length} of ${found.switches.length})` : "";
  const failure =
    failed.length > 0 ? ` ${switchCount(failed.length)} did not respond.` : "";
  if (changed.length === 0) {
    const text = `Switch ${label}: nothing changed.${failure}`;
    return { discord: `⚠️ ${escapeMarkdown(text)}`, game: [text] };
  }
  return {
    discord: `${on ? "🟢" : "🔴"} Switch **${escapeMarkdown(found.name)}** ${verb}${count}.${failure}`,
    game: [`Switch ${label} ${verb}${count} by ${author}.${failure}`],
    announce: true,
  };
}

export const switchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Turn the factory's power switches on or off")
    .addSubcommand((sub) => sub.setName("list").setDescription("See the switches and their state"))
    .addSubcommand((sub) =>
      sub
        .setName("on")
        .setDescription("Turn a switch on (and every switch with the same name)")
        .addStringOption((option) =>
          option.setName("name").setDescription("Name of the switch").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("off")
        .setDescription("Turn a switch off (and every switch with the same name)")
        .addStringOption((option) =>
          option.setName("name").setDescription("Name of the switch").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!switch <name> on|off | !switches",

  parseGame(text): CommandArgs | undefined {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || (words.length === 1 && normalize(words[0]) === "list")) {
      return { subcommand: "list", options: {} };
    }
    // The action can come first or last: "!switch off iron factory", "!switch iron factory off".
    const first = ACTIONS[normalize(words[0])];
    const last = ACTIONS[normalize(words[words.length - 1])];
    const action = first ?? last;
    const name = first ? words.slice(1) : words.slice(0, -1);
    if (!action || name.length === 0) return undefined;
    return { subcommand: action, options: { name: name.join(" ") } };
  },

  async run({ subcommand, options, author }) {
    if (subcommand === "on" || subcommand === "off") {
      return toggle(options.name ?? "", subcommand === "on", author);
    }
    return list();
  },

  async autocomplete(interaction) {
    const groups = (await forAutocomplete(cachedGroups)) ?? [];
    const candidates = groups.map((g) => ({
      label: `${state(g).icon} ${g.name}${g.switches.length > 1 ? ` (${g.switches.length})` : ""}`,
      value: g.key,
      search: g.name,
    }));
    await interaction.respond(suggestions(candidates, interaction.options.getFocused()));
  },
};
