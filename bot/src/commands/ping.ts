// /ping <place> [message]: places a marker in the game on a named place or a player,
// and announces it in the game chat so that players know where it comes from.

import { SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { FrmError, frm } from "../frm.ts";
import { discordSender, forGame } from "../game-chat.ts";
import { cachedNamedPlaces, cachedPlayers, loadNamedPlaces, placeCandidates, placeLabel, playerPlaces } from "./places.ts";
import { forAutocomplete, resolve, suggestions, type Command } from "./shared.ts";

const MAX_NOTE_LENGTH = 200;

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Places a marker in the game on a place (HUB, train station, map marker) or a player")
    .addStringOption((option) =>
      option.setName("place").setDescription("Where to place the marker").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Text sent with the marker in the game chat")
        .setMaxLength(MAX_NOTE_LENGTH),
    )
    .toJSON(),

  async run({ options, author }) {
    const typed = options.place ?? "";
    const note = options.message?.replace(/\s+/g, " ").trim();

    const [named, players] = await Promise.all([loadNamedPlaces(), frm.players()]);
    const places = [...named, ...playerPlaces(players)];
    const { found, ambiguous } = resolve(places, typed, (p) => p.key, (p) => p.name);
    if (!found) {
      const reason =
        ambiguous.length > 0
          ? `several places match: ${ambiguous.map((n) => `**${escapeMarkdown(n)}**`).join(", ")}.`
          : "no HUB, train station, map marker or online player with this name.";
      return {
        discord: `❓ "${escapeMarkdown(typed)}": ${reason}\nPick the place from the list shown while typing.`,
        game: [],
      };
    }

    try {
      await frm.createPing(found.location);
    } catch (error) {
      if (error instanceof FrmError && error.message.includes("No player connected")) {
        return { discord: "😴 Nobody is in the game: nobody would see the marker.", game: [] };
      }
      throw error;
    }

    // The announcement in the game chat is part of the command: no extra copy (empty game).
    const announce = note ? `Marker on ${found.name}: ${note}` : `Marker placed on ${found.name}`;
    let chatWarning = "";
    try {
      await frm.sendChatMessage(discordSender(author), forGame(announce));
    } catch (error) {
      console.warn("/ping: cannot announce in the game chat:", error instanceof Error ? error.message : error);
      chatWarning = "\n⚠️ The announcement could not be sent to the game chat.";
    }

    const noteText = note ? `: "${escapeMarkdown(note)}"` : "";
    return {
      discord: `📍 Marker placed in game on ${escapeMarkdown(placeLabel(found))}${noteText}${chatWarning}`,
      game: [],
    };
  },

  async autocomplete(interaction) {
    const [named, players] = await Promise.all([forAutocomplete(cachedNamedPlaces), forAutocomplete(cachedPlayers)]);
    const places = [...(named ?? []), ...playerPlaces(players ?? [])];
    await interaction.respond(suggestions(placeCandidates(places), interaction.options.getFocused()));
  },
};
