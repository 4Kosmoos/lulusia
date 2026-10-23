// /power: details of each power circuit (the #statut message only shows the total).

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { mw, plural } from "@lulusia/lib/format";
import type { PowerCircuit } from "@lulusia/lib/frm";
import { hasProblem, isActive } from "@lulusia/lib/power";
import { batteryText, powerLines } from "../circuits.ts";
import { frm } from "../frm.ts";
import type { Command } from "./shared.ts";

const COLORS = { ok: 0x2ecc71, problem: 0xe67e22, idle: 0x95a5a6 };
const MAX_SHOWN = 10;
const MAX_SHOWN_IN_GAME = 3;

const circuitName = (index: number) => (index === 0 ? "Main circuit" : `Circuit ${index + 1}`);

function circuitText(circuit: PowerCircuit): string {
  const lines = powerLines([circuit]);
  const batteries = batteryText([circuit]);
  if (batteries) lines.push(`🔋 Batteries: ${batteries}`);
  if (circuit.FuseTriggered) lines.push("⚠️ **Fuse blown!**");
  return lines.join("\n");
}

/** One line per circuit for the game chat, plus one for the batteries. */
function circuitGameLines(circuit: PowerCircuit, index: number): string[] {
  const margin = circuit.PowerCapacity - circuit.PowerMaxConsumed;
  const marginText = margin < 0 ? `${mw(-margin)} short at full load` : `margin ${mw(margin)}`;
  const fuse = circuit.FuseTriggered ? " FUSE BLOWN!" : "";
  const lines = [
    `${circuitName(index)}: ${mw(circuit.PowerConsumed)} (max ${mw(circuit.PowerMaxConsumed)}) of ${mw(circuit.PowerCapacity)}, ${marginText}.${fuse}`,
  ];
  const batteries = batteryText([circuit]);
  if (batteries) lines.push(`${circuitName(index)}, batteries: ${batteries}`);
  return lines;
}

export const power: Command = {
  data: new SlashCommandBuilder()
    .setName("power")
    .setDescription("Details of each power circuit: consumption, capacity, batteries, fuses")
    .toJSON(),
  gameUsage: "!power",

  async run() {
    const circuits = (await frm.power()).filter(isActive).sort((a, b) => b.PowerCapacity - a.PowerCapacity);

    const embed = new EmbedBuilder().setTitle("⚡ Power circuits");
    if (circuits.length === 0) {
      return {
        discord: embed.setColor(COLORS.idle).setDescription("No active power circuit."),
        game: ["No active power circuit."],
      };
    }

    const shown = circuits.slice(0, MAX_SHOWN);
    embed
      .setColor(hasProblem(circuits) ? COLORS.problem : COLORS.ok)
      .setDescription(circuits.length > 1 ? `${plural(circuits.length, "active circuit")}, largest first.` : null)
      .addFields(shown.map((circuit, index) => ({ name: circuitName(index), value: circuitText(circuit) })));
    const hidden = circuits.length - shown.length;
    if (hidden > 0) {
      embed.setFooter({ text: `+ ${plural(hidden, "small circuit")} not shown` });
    }

    const game = circuits.slice(0, MAX_SHOWN_IN_GAME).flatMap(circuitGameLines);
    const hiddenInGame = circuits.length - MAX_SHOWN_IN_GAME;
    if (hiddenInGame > 0) game.push(`+ ${plural(hiddenInGame, "small circuit")} (details on Discord: /power)`);

    return { discord: embed, game };
  },
};
