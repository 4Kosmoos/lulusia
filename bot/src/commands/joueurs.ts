// /joueurs : qui est connecté, où, et dans quel état.

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { formatInteger, plural } from "../format.ts";
import { frm, type Player } from "../frm.ts";
import { loadNamedPlaces, whereIs, type Place } from "./places.ts";
import type { Command } from "./shared.ts";

const COLORS = { online: 0x2ecc71, empty: 0x95a5a6 };

const playerName = (player: Player) => player.Name || "Pionnier sans nom";
const health = (player: Player) => (player.Dead ? "mort" : `${formatInteger(player.PlayerHP)} PV`);
const movement = (player: Player) => (player.Speed >= 1 ? `${formatInteger(player.Speed)} km/h` : "à l'arrêt");

function playerText(player: Player, places: Place[]): string {
  return [
    `${player.Dead ? "💀" : "❤️"} ${health(player)} · ${player.Speed >= 1 ? "🏃" : "🧍"} ${movement(player)}`,
    `📍 ${whereIs(player.location, places)}`,
  ].join("\n");
}

export const joueurs: Command = {
  data: new SlashCommandBuilder()
    .setName("joueurs")
    .setDescription("Qui est connecté, où, et dans quel état")
    .toJSON(),
  gameUsage: "!joueurs",

  async run() {
    const [players, places] = await Promise.all([frm.players(), loadNamedPlaces()]);
    const online = players.filter((p) => p.Online);
    const offline = players.length - online.length;

    const embed = new EmbedBuilder().setTitle(`👷 Joueurs connectés (${online.length})`);
    if (online.length === 0) {
      embed.setColor(COLORS.empty).setDescription("Personne n'est connecté en ce moment.");
    } else {
      embed
        .setColor(COLORS.online)
        .addFields(online.map((player) => ({ name: playerName(player), value: playerText(player, places) })));
    }
    if (offline > 0) embed.setFooter({ text: `${plural(offline, "pionnier")} hors ligne` });

    const game =
      online.length === 0
        ? ["Personne n'est connecté en ce moment."]
        : online.map(
            (player) => `${playerName(player)} : ${health(player)}, ${movement(player)}, ${whereIs(player.location, places, false)}`,
          );
    return { discord: embed, game };
  },
};
