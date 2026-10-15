// /machines : état, mise en pause et relance de toutes les machines qui fabriquent un objet
// (produit principal de leur recette), par exemple quand ses stockages débordent.
// Dans le jeu : !machines pause iron plate, !machines relancer iron plate, !machines iron plate.

import { SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { normalize, plural } from "../format.ts";
import { frm, type Machine } from "../frm.ts";
import { findItem, itemCandidates, type Item } from "./inventory.ts";
import { cached, forAutocomplete, suggestions, type Command, type CommandArgs, type CommandResult } from "./shared.ts";

/** Produit principal de la recette, ou undefined pour une machine sans recette. */
function mainProduct(machine: Machine) {
  const product = machine.production?.[0];
  return product && product.ClassName !== "Unassigned" ? product : undefined;
}

/** Objets fabriqués par au moins une machine, triés par nom. */
function producedItems(machines: Machine[]): Item[] {
  const items = new Map<string, string>();
  for (const machine of machines) {
    const product = mainProduct(machine);
    if (product) items.set(product.ClassName, product.Name);
  }
  return [...items]
    .map(([className, name]) => ({ className, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

const cachedMachines = cached(() => frm.machines(), 30_000);

/** « 12 Constructor, 2 Assembler » */
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
      ? `plusieurs objets correspondent : ${ambiguous.join(", ")}`
      : "aucune machine ne fabrique cet objet (noms du serveur, ex. iron plate)";
  return { discord: `❓ « ${escapeMarkdown(typed)} » : ${escapeMarkdown(reason)}.`, game: [`"${typed}" : ${reason}.`] };
}

function statusText(item: Item, machines: Machine[]): string {
  const paused = machines.filter((m) => m.IsPaused).length;
  const producing = machines.filter((m) => !m.IsPaused && m.IsProducing).length;
  const idle = machines.length - paused - producing;
  const parts = [`${producing} en production`];
  if (idle > 0) parts.push(`${idle} à l'arrêt (ingrédients ou sortie pleine)`);
  if (paused > 0) parts.push(`${paused} en pause`);
  return `${item.name} : ${plural(machines.length, "machine")} (${byType(machines)}) : ${parts.join(", ")}.`;
}

async function run(action: "etat" | "pause" | "relancer", typed: string, author: string): Promise<CommandResult> {
  const machines = await frm.machines();
  const { found, ambiguous } = findItem(producedItems(machines), typed);
  if (!found) return notFound(typed, ambiguous);

  const concerned = machines.filter((m) => mainProduct(m)?.ClassName === found.className);
  if (action === "etat") {
    const text = statusText(found, concerned);
    return { discord: `🏭 ${escapeMarkdown(text)}`, game: [text] };
  }

  const pause = action === "pause";
  const targets = concerned.filter((m) => m.IsPaused !== pause);
  if (targets.length === 0) {
    const text = `Toutes les machines de ${found.name} sont déjà ${pause ? "en pause" : "en marche"}.`;
    return { discord: `${pause ? "⏸️" : "▶️"} ${escapeMarkdown(text)}`, game: [text] };
  }

  const { changed, failed } = await frm.setMachines(targets.map((m) => m.ID), !pause);
  const done = targets.filter((m) => changed.includes(m.ID));
  const failure = failed.length > 0 ? ` ${plural(failed.length, "machine")} ${failed.length > 1 ? "n'ont" : "n'a"} pas répondu.` : "";
  if (done.length === 0) {
    const text = `${found.name} : aucune machine n'a changé.${failure}`;
    return { discord: `⚠️ ${escapeMarkdown(text)}`, game: [text] };
  }
  const verb = pause ? (done.length > 1 ? "mises en pause" : "mise en pause") : done.length > 1 ? "relancées" : "relancée";
  const what = `${plural(done.length, "machine")} de ${found.name} ${verb} (${byType(done)})`;
  return {
    discord: `${pause ? "⏸️" : "▶️"} ${escapeMarkdown(what)}.${failure}`,
    game: [`${what} par ${author}.${failure}`],
    announce: true,
  };
}

export const machines: Command = {
  data: new SlashCommandBuilder()
    .setName("machines")
    .setDescription("État, pause ou relance de toutes les machines qui fabriquent un objet")
    .addSubcommand((sub) =>
      sub
        .setName("etat")
        .setDescription("Combien de machines fabriquent l'objet, et dans quel état")
        .addStringOption((option) =>
          option.setName("objet").setDescription("L'objet fabriqué").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pause")
        .setDescription("Mettre en pause toutes les machines qui fabriquent l'objet")
        .addStringOption((option) =>
          option.setName("objet").setDescription("L'objet fabriqué").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("relancer")
        .setDescription("Relancer toutes les machines en pause qui fabriquent l'objet")
        .addStringOption((option) =>
          option.setName("objet").setDescription("L'objet fabriqué").setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  gameUsage: "!machines pause|relancer|etat <objet>",

  parseGame(text): CommandArgs | undefined {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;
    const first = normalize(words[0]);
    const action = first === "pause" || first === "relancer" || first === "etat" ? first : undefined;
    const objet = (action ? words.slice(1) : words).join(" ");
    if (!objet) return undefined;
    return { subcommand: action ?? "etat", options: { objet } };
  },

  async run({ subcommand, options, author }) {
    const action = subcommand === "pause" || subcommand === "relancer" ? subcommand : "etat";
    return run(action, options.objet ?? "", author);
  },

  async autocomplete(interaction) {
    const list = (await forAutocomplete(cachedMachines)) ?? [];
    await interaction.respond(suggestions(itemCandidates(producedItems(list)), interaction.options.getFocused()));
  },
};
