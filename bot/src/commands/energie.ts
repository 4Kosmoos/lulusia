// /energie : détail de chaque réseau électrique (le message de #statut n'en donne que le total).

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { mw, plural } from "../format.ts";
import { frm, type PowerCircuit } from "../frm.ts";
import { batteryText, hasProblem, isActive, powerLines } from "../power.ts";
import type { Command } from "./shared.ts";

const COLORS = { ok: 0x2ecc71, problem: 0xe67e22, idle: 0x95a5a6 };
const MAX_SHOWN = 10;
const MAX_SHOWN_IN_GAME = 3;

const circuitName = (index: number) => (index === 0 ? "Réseau principal" : `Réseau ${index + 1}`);

function circuitText(circuit: PowerCircuit): string {
  const lines = powerLines([circuit]);
  const batteries = batteryText([circuit]);
  if (batteries) lines.push(`🔋 Batteries : ${batteries}`);
  if (circuit.FuseTriggered) lines.push("⚠️ **Fusible grillé !**");
  return lines.join("\n");
}

/** Une ligne par réseau pour le chat du jeu, plus une pour les batteries. */
function circuitGameLines(circuit: PowerCircuit, index: number): string[] {
  const margin = circuit.PowerCapacity - circuit.PowerMaxConsumed;
  const marginText = margin < 0 ? `il manque ${mw(-margin)} si tout tourne à fond` : `marge ${mw(margin)}`;
  const fuse = circuit.FuseTriggered ? " FUSIBLE GRILLÉ !" : "";
  const lines = [
    `${circuitName(index)} : ${mw(circuit.PowerConsumed)} (max ${mw(circuit.PowerMaxConsumed)}) sur ${mw(circuit.PowerCapacity)}, ${marginText}.${fuse}`,
  ];
  const batteries = batteryText([circuit]);
  if (batteries) lines.push(`${circuitName(index)}, batteries : ${batteries}`);
  return lines;
}

export const energie: Command = {
  data: new SlashCommandBuilder()
    .setName("energie")
    .setDescription("Détail de chaque réseau électrique : consommation, capacité, batteries, fusibles")
    .toJSON(),
  gameUsage: "!energie",

  async run() {
    const circuits = (await frm.power()).filter(isActive).sort((a, b) => b.PowerCapacity - a.PowerCapacity);

    const embed = new EmbedBuilder().setTitle("⚡ Réseaux électriques");
    if (circuits.length === 0) {
      return {
        discord: embed.setColor(COLORS.idle).setDescription("Aucun réseau électrique actif."),
        game: ["Aucun réseau électrique actif."],
      };
    }

    const shown = circuits.slice(0, MAX_SHOWN);
    embed
      .setColor(hasProblem(circuits) ? COLORS.problem : COLORS.ok)
      .setDescription(circuits.length > 1 ? `${plural(circuits.length, "réseau", "réseaux")} actifs, du plus gros au plus petit.` : null)
      .addFields(shown.map((circuit, index) => ({ name: circuitName(index), value: circuitText(circuit) })));
    const hidden = circuits.length - shown.length;
    if (hidden > 0) {
      embed.setFooter({ text: `+ ${plural(hidden, "petit réseau non affiché", "petits réseaux non affichés")}` });
    }

    const game = circuits.slice(0, MAX_SHOWN_IN_GAME).flatMap(circuitGameLines);
    const hiddenInGame = circuits.length - MAX_SHOWN_IN_GAME;
    if (hiddenInGame > 0) game.push(`+ ${plural(hiddenInGame, "petit réseau", "petits réseaux")} (détail sur Discord : /energie)`);

    return { discord: embed, game };
  },
};
