// /players: who is online, where, and in what state.

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { formatInteger, plural } from "../format.ts";
import { frm, type Player } from "../frm.ts";
import { loadNamedPlaces, whereIs, type Place } from "./places.ts";
import type { Command } from "./shared.ts";

const COLORS = { online: 0x2ecc71, empty: 0x95a5a6 };

const playerName = (player: Player) => player.Name || "Unnamed pioneer";
const health = (player: Player) => (player.Dead ? "dead" : `${formatInteger(player.PlayerHP)} HP`);
const movement = (player: Player) => (player.Speed >= 1 ? `${formatInteger(player.Speed)} km/h` : "standing still");

function playerText(player: Player, places: Place[]): string {
  return [
    `${player.Dead ? "💀" : "❤️"} ${health(player)} · ${player.Speed >= 1 ? "🏃" : "🧍"} ${movement(player)}`,
    `📍 ${whereIs(player.location, places)}`,
  ].join("\n");
}

export const players: Command = {
  data: new SlashCommandBuilder()
    .setName("players")
    .setDescription("Who is online, where, and in what state")
    .toJSON(),
  gameUsage: "!players",

  async run() {
    const [list, places] = await Promise.all([frm.players(), loadNamedPlaces()]);
    const online = list.filter((p) => p.Online);
    const offline = list.length - online.length;

    const embed = new EmbedBuilder().setTitle(`👷 Players online (${online.length})`);
    if (online.length === 0) {
      embed.setColor(COLORS.empty).setDescription("Nobody is online right now.");
    } else {
      embed
        .setColor(COLORS.online)
        .addFields(online.map((player) => ({ name: playerName(player), value: playerText(player, places) })));
    }
    if (offline > 0) embed.setFooter({ text: `${plural(offline, "pioneer")} offline` });

    const game =
      online.length === 0
        ? ["Nobody is online right now."]
        : online.map(
            (player) => `${playerName(player)}: ${health(player)}, ${movement(player)}, ${whereIs(player.location, places, false)}`,
          );
    return { discord: embed, game };
  },
};
