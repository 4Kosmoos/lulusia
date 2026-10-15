// /machines: status, pause and resume of every machine that makes an item (main product of its recipe),
// for example when its storage overflows.
// In game: !machines pause iron plate, !machines resume iron plate, !machines iron plate.

import { SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { normalize, plural } from "../format.ts";
import { frm, type Machine } from "../frm.ts";
import { findItem, itemCandidates, type Item } from "./inventory.ts";
import { cached, forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";

type Action = "status" | "pause" | "resume";
const ACTIONS: Action[] = ["status", "pause", "resume"];

/** Main product of the recipe, or undefined for a machine without a recipe. */
function mainProduct(machine: Machine) {
  const product = machine.production?.[0];
  return product && product.ClassName !== "Unassigned" ? product : undefined;
}

/** Items made by at least one machine, sorted by name. */
function producedItems(machines: Machine[]): Item[] {
  const items = new Map<string, string>();
  for (const machine of machines) {
    const product = mainProduct(machine);
    if (product) items.set(product.ClassName, product.Name);
  }
  return [...items]
    .map(([className, name]) => ({ className, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const cachedMachines = cached(() => frm.machines(), 30_000);

/** "12 Constructor, 2 Assembler" */
function byType(machines: Machine[]): string {
  const counts = new Map<string, number>();
  for (const m of machines) counts.set(m.Name, (counts.get(m.Name) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
}

function notFound(typed: string, ambiguous: string[]): CommandResult {
  const reason =
    ambiguous.length > 0
      ? `several items match: ${ambiguous.join(", ")}`
      : "no machine makes this item (server names, e.g. iron plate)";
  return { discord: `❓ "${escapeMarkdown(typed)}": ${escapeMarkdown(reason)}.`, game: [`"${typed}": ${reason}.`] };
}

function statusText(item: Item, machines: Machine[]): string {
  const paused = machines.filter((m) => m.IsPaused).length;
  const producing = machines.filter((m) => !m.IsPaused && m.IsProducing).length;
  const idle = machines.length - paused - producing;
  const parts = [`${producing} producing`];
  if (idle > 0) parts.push(`${idle} idle (missing inputs or output full)`);
  if (paused > 0) parts.push(`${paused} paused`);
  return `${item.name}: ${plural(machines.length, "machine")} (${byType(machines)}): ${parts.join(", ")}.`;
}

async function run(action: Action, typed: string, author: string): Promise<CommandResult> {
  const machines = await frm.machines();
  const { found, ambiguous } = findItem(producedItems(machines), typed);
  if (!found) return notFound(typed, ambiguous);

  const concerned = machines.filter((m) => mainProduct(m)?.ClassName === found.className);
  if (action === "status") {
    const text = statusText(found, concerned);
    return { discord: `🏭 ${escapeMarkdown(text)}`, game: [text] };
  }

  const pause = action === "pause";
  const targets = concerned.filter((m) => m.IsPaused !== pause);
  if (targets.length === 0) {
    const text = `All ${found.name} machines are already ${pause ? "paused" : "running"}.`;
    return { discord: `${pause ? "⏸️" : "▶️"} ${escapeMarkdown(text)}`, game: [text] };
  }

  const { changed, failed } = await frm.setMachines(targets.map((m) => m.ID), !pause);
  const done = targets.filter((m) => changed.includes(m.ID));
  const failure = failed.length > 0 ? ` ${plural(failed.length, "machine")} did not respond.` : "";
  if (done.length === 0) {
    const text = `${found.name}: no machine changed.${failure}`;
    return { discord: `⚠️ ${escapeMarkdown(text)}`, game: [text] };
  }
  const what = `${plural(done.length, `${found.name} machine`)} ${pause ? "paused" : "resumed"} (${byType(done)})`;
  return {
    discord: `${pause ? "⏸️" : "▶️"} ${escapeMarkdown(what)}.${failure}`,
    game: [`${what} by ${author}.${failure}`],
    announce: true,
  };
}

export const machines: Command = {
  data: new SlashCommandBuilder()
    .setName("machines")
    .setDescription("Status, pause or resume of every machine that makes an item")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("How many machines make the item, and in what state")
        .addStringOption((option) =>
          option.setName("item").setDescription("The item made").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pause")
        .setDescription("Pause every machine that makes the item")
        .addStringOption((option) =>
          option.setName("item").setDescription("The item made").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("resume")
        .setDescription("Resume every paused machine that makes the item")
        .addStringOption((option) =>
          option.setName("item").setDescription("The item made").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!machines pause|resume|status <item>",

  parseGame(text): CommandArgs | undefined {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;
    const first = normalize(words[0]);
    const action = ACTIONS.find((a) => a === first);
    const item = (action ? words.slice(1) : words).join(" ");
    if (!item) return undefined;
    return { subcommand: action ?? "status", options: { item } };
  },

  async run({ subcommand, options, author }) {
    const action = ACTIONS.find((a) => a === subcommand) ?? "status";
    return run(action, options.item ?? "", author);
  },

  async autocomplete(interaction) {
    const list = (await forAutocomplete(cachedMachines)) ?? [];
    await interaction.respond(suggestions(itemCandidates(producedItems(list)), interaction.options.getFocused()));
  },
};
