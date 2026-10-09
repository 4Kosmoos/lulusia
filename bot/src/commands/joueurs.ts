// /joueurs : qui est connecté, où, et dans quel état.

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { formatInteger, plural } from "../format.ts";
import { frm, type Player } from "../frm.ts";
import { loadNamedPlaces, whereIs, type Place } from "./places.ts";
import type { Command } from "./shared.ts";

const COLORS = { online: 0x2ecc71, empty: 0x95a5a6 };

function playerText(player: Player, places: Place[]): string {
  const health = player.Dead ? "💀 Mort" : `❤️ ${formatInteger(player.PlayerHP)} PV`;
  const movement = player.Speed >= 1 ? `🏃 ${formatInteger(player.Speed)} km/h` : "🧍 À l'arrêt";
  return [`${health} · ${movement}`, `📍 ${whereIs(player.location, places)}`].join("\n");
}

export const joueurs: Command = {
  data: new SlashCommandBuilder()
    .setName("joueurs")
    .setDescription("Qui est connecté, où, et dans quel état")
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply();
    const [players, places] = await Promise.all([frm.players(), loadNamedPlaces()]);
    const online = players.filter((p) => p.Online);
    const offline = players.length - online.length;

    const embed = new EmbedBuilder().setTitle(`👷 Joueurs connectés (${online.length})`);
    if (online.length === 0) {
      embed.setColor(COLORS.empty).setDescription("Personne n'est connecté en ce moment.");
    } else {
      embed.setColor(COLORS.online).addFields(
        online.map((player) => ({
          name: player.Name || "Pionnier sans nom",
          value: playerText(player, places),
        })),
      );
    }
    if (offline > 0) embed.setFooter({ text: `${plural(offline, "pionnier")} hors ligne` });
    await interaction.editReply({ embeds: [embed] });
  },
};
