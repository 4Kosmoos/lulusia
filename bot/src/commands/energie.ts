// /energie : détail de chaque réseau électrique (le message de #statut n'en donne que le total).

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { plural } from "../format.ts";
import { frm, type PowerCircuit } from "../frm.ts";
import { batteryText, hasProblem, isActive, powerLines } from "../power.ts";
import type { Command } from "./shared.ts";

const COLORS = { ok: 0x2ecc71, problem: 0xe67e22, idle: 0x95a5a6 };
const MAX_SHOWN = 10;

function circuitText(circuit: PowerCircuit): string {
  const lines = powerLines([circuit]);
  const batteries = batteryText([circuit]);
  if (batteries) lines.push(`🔋 Batteries : ${batteries}`);
  if (circuit.FuseTriggered) lines.push("⚠️ **Fusible grillé !**");
  return lines.join("\n");
}

export const energie: Command = {
  data: new SlashCommandBuilder()
    .setName("energie")
    .setDescription("Détail de chaque réseau électrique : consommation, capacité, batteries, fusibles")
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply();
    const circuits = (await frm.power()).filter(isActive).sort((a, b) => b.PowerCapacity - a.PowerCapacity);

    const embed = new EmbedBuilder().setTitle("⚡ Réseaux électriques");
    if (circuits.length === 0) {
      await interaction.editReply({ embeds: [embed.setColor(COLORS.idle).setDescription("Aucun réseau électrique actif.")] });
      return;
    }

    const shown = circuits.slice(0, MAX_SHOWN);
    embed
      .setColor(hasProblem(circuits) ? COLORS.problem : COLORS.ok)
      .setDescription(circuits.length > 1 ? `${plural(circuits.length, "réseau", "réseaux")} actifs, du plus gros au plus petit.` : null)
      .addFields(
        shown.map((circuit, index) => ({
          name: index === 0 ? "Réseau principal" : `Réseau ${index + 1}`,
          value: circuitText(circuit),
        })),
      );
    const hidden = circuits.length - shown.length;
    if (hidden > 0) {
      embed.setFooter({ text: `+ ${plural(hidden, "petit réseau non affiché", "petits réseaux non affichés")}` });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
