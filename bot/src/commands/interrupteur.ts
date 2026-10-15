// /interrupteur : allumer ou couper les interrupteurs électriques de l'usine, par le nom qu'on leur
// donne en jeu. Les interrupteurs qui portent le même nom sont pilotés ensemble.
// Dans le jeu : !interrupteur usine fer off, !interrupteurs.

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { normalize, plural } from "../format.ts";
import { frm, type PowerSwitch } from "../frm.ts";
import { cachedNamedPlaces, whereIs, type Place } from "./places.ts";
import { cached, forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";

const COLORS = { on: 0x2ecc71, off: 0xe74c3c, mixed: 0xf1c40f };
const MAX_LISTED_IN_GAME = 10;
const ON_WORDS = new Set(["on", "allumer", "allume", "marche"]);
const OFF_WORDS = new Set(["off", "couper", "coupe", "eteindre", "arret", "stop"]);

interface SwitchGroup {
  /** « nom:<nom> » pour un groupe nommé, « id:<ID> » pour un interrupteur sans nom. */
  key: string;
  name: string;
  named: boolean;
  switches: PowerSwitch[];
}

function groupSwitches(switches: PowerSwitch[], places: Place[]): SwitchGroup[] {
  const groups = new Map<string, SwitchGroup>();
  for (const s of switches) {
    const tag = s.SwitchTag.trim();
    const key = tag ? `nom:${normalize(tag)}` : `id:${s.ID}`;
    const group = groups.get(key) ?? {
      key,
      name: tag || `Sans nom, ${whereIs(s.location, places, false)}`,
      named: Boolean(tag),
      switches: [],
    };
    group.switches.push(s);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.named) - Number(a.named) || a.name.localeCompare(b.name, "fr"));
}

async function loadGroups(): Promise<SwitchGroup[]> {
  const [switches, places] = await Promise.all([frm.switches(), cachedNamedPlaces()]);
  return groupSwitches(switches, places);
}
const cachedGroups = cached(loadGroups, 10_000);

function state(group: SwitchGroup): { icon: string; text: string; color: number } {
  const on = group.switches.filter((s) => s.IsOn).length;
  if (on === group.switches.length) return { icon: "🟢", text: "allumé", color: COLORS.on };
  if (on === 0) return { icon: "🔴", text: "coupé", color: COLORS.off };
  return { icon: "🟡", text: `${on}/${group.switches.length} allumés`, color: COLORS.mixed };
}

function details(group: SwitchGroup): string {
  const parts: string[] = [];
  if (group.switches.length > 1) parts.push(plural(group.switches.length, "interrupteur"));
  const priorities = [...new Set(group.switches.filter((s) => s.Priority >= 0).map((s) => s.Priority))];
  if (priorities.length > 0) parts.push(`priorité ${priorities.join(", ")}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** Le groupe choisi dans les suggestions, ou tapé à la main : nom exact, sinon seul nom qui contient le texte. */
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
    const text = "Aucun interrupteur électrique dans l'usine.";
    return { discord: `⚡ ${text}`, game: [text] };
  }
  const lines = groups.map((g) => `${state(g).icon} **${escapeMarkdown(g.name)}** : ${state(g).text}${details(g)}`);
  const unnamed = groups.filter((g) => !g.named).length;
  const embed = new EmbedBuilder()
    .setTitle(`⚡ Interrupteurs (${groups.reduce((n, g) => n + g.switches.length, 0)})`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: unnamed > 0
        ? "Astuce : donner un nom aux interrupteurs en jeu pour les piloter plus facilement."
        : "Les interrupteurs qui portent le même nom sont pilotés ensemble.",
    });
  const game = groups.slice(0, MAX_LISTED_IN_GAME).map((g) => `${g.name} : ${state(g).text}${details(g)}`);
  if (groups.length > MAX_LISTED_IN_GAME) game.push(`+ ${groups.length - MAX_LISTED_IN_GAME} autres (liste complète sur Discord : /interrupteur liste)`);
  return { discord: embed, game };
}

async function toggle(typed: string, on: boolean, author: string): Promise<CommandResult> {
  const groups = await loadGroups();
  const { found, ambiguous } = findGroup(groups, typed);
  if (!found) {
    const reason =
      ambiguous.length > 0
        ? `plusieurs interrupteurs correspondent : ${ambiguous.join(", ")}`
        : "aucun interrupteur de ce nom (voir la liste : /interrupteur liste ou !interrupteurs)";
    return { discord: `❓ « ${escapeMarkdown(typed)} » : ${escapeMarkdown(reason)}.`, game: [`"${typed}" : ${reason}.`] };
  }

  const verb = on ? "allumé" : "coupé";
  const label = `« ${found.name} »`;
  const targets = found.switches.filter((s) => s.IsOn !== on).map((s) => s.ID);
  if (targets.length === 0) {
    const text = `L'interrupteur ${label} est déjà ${verb}.`;
    return { discord: `${on ? "🟢" : "🔴"} ${escapeMarkdown(text)}`, game: [text] };
  }

  const { changed, failed } = await frm.setSwitches(targets, on);
  const count = found.switches.length > 1 ? ` (${changed.length} sur ${found.switches.length})` : "";
  const failure =
    failed.length > 0 ? ` ${plural(failed.length, "interrupteur")} ${failed.length > 1 ? "n'ont" : "n'a"} pas répondu.` : "";
  if (changed.length === 0) {
    const text = `Interrupteur ${label} : rien n'a changé.${failure}`;
    return { discord: `⚠️ ${escapeMarkdown(text)}`, game: [text] };
  }
  return {
    discord: `${on ? "🟢" : "🔴"} Interrupteur **${escapeMarkdown(found.name)}** ${verb}${count}.${failure}`,
    game: [`Interrupteur ${label} ${verb}${count} par ${author}.${failure}`],
    announce: true,
  };
}

export const interrupteur: Command = {
  data: new SlashCommandBuilder()
    .setName("interrupteur")
    .setDescription("Allumer ou couper les interrupteurs électriques de l'usine")
    .addSubcommand((sub) => sub.setName("liste").setDescription("Voir les interrupteurs et leur état"))
    .addSubcommand((sub) =>
      sub
        .setName("allumer")
        .setDescription("Allumer un interrupteur (et tous ceux qui portent le même nom)")
        .addStringOption((option) =>
          option.setName("nom").setDescription("Nom de l'interrupteur").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("couper")
        .setDescription("Couper un interrupteur (et tous ceux qui portent le même nom)")
        .addStringOption((option) =>
          option.setName("nom").setDescription("Nom de l'interrupteur").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!interrupteur <nom> on|off | !interrupteurs",

  parseGame(text): CommandArgs | undefined {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || (words.length === 1 && normalize(words[0]) === "liste")) {
      return { subcommand: "liste", options: {} };
    }
    // L'action peut être au début ou à la fin : « !interrupteur off usine fer », « !interrupteur usine fer off ».
    const first = normalize(words[0]);
    const last = normalize(words[words.length - 1]);
    let action: string | undefined;
    let name: string[] = [];
    if (ON_WORDS.has(first) || OFF_WORDS.has(first)) {
      action = ON_WORDS.has(first) ? "allumer" : "couper";
      name = words.slice(1);
    } else if (ON_WORDS.has(last) || OFF_WORDS.has(last)) {
      action = ON_WORDS.has(last) ? "allumer" : "couper";
      name = words.slice(0, -1);
    }
    if (!action || name.length === 0) return undefined;
    return { subcommand: action, options: { nom: name.join(" ") } };
  },

  async run({ subcommand, options, author }) {
    if (subcommand === "allumer" || subcommand === "couper") {
      return toggle(options.nom ?? "", subcommand === "allumer", author);
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
