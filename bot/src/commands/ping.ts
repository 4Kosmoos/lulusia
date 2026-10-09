// /ping <lieu> [message] : pose un marqueur dans le jeu sur un lieu nommé ou un joueur,
// et l'annonce dans le chat du jeu pour que les joueurs sachent d'où il vient.

import { SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { gameSenderName } from "../chat.ts";
import { FrmError, frm } from "../frm.ts";
import { cachedNamedPlaces, cachedPlayers, loadNamedPlaces, placeCandidates, placeLabel, playerPlaces } from "./places.ts";
import { forAutocomplete, resolve, suggestions, type Command } from "./shared.ts";

const MAX_NOTE_LENGTH = 200;

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Pose un marqueur dans le jeu sur un lieu (HUB, gare, marqueur de carte) ou un joueur")
    .addStringOption((option) =>
      option.setName("lieu").setDescription("Où poser le marqueur").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Texte envoyé avec le marqueur dans le chat du jeu")
        .setMaxLength(MAX_NOTE_LENGTH),
    )
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply();
    const typed = interaction.options.getString("lieu", true);
    const note = interaction.options.getString("message")?.replace(/\s+/g, " ").trim();

    const [named, players] = await Promise.all([loadNamedPlaces(), frm.players()]);
    const places = [...named, ...playerPlaces(players)];
    const { found, ambiguous } = resolve(places, typed, (p) => p.key, (p) => p.name);
    if (!found) {
      const reason =
        ambiguous.length > 0
          ? `plusieurs lieux correspondent : ${ambiguous.map((n) => `**${escapeMarkdown(n)}**`).join(", ")}.`
          : "aucun HUB, gare, marqueur de carte ou joueur connecté de ce nom.";
      await interaction.editReply(
        `❓ « ${escapeMarkdown(typed)} » : ${reason}\nChoisis le lieu dans la liste proposée pendant la saisie.`,
      );
      return;
    }

    try {
      await frm.createPing(found.location);
    } catch (error) {
      if (error instanceof FrmError && error.message.includes("No player connected")) {
        await interaction.editReply("😴 Personne n'est connecté au jeu : le marqueur ne serait vu par personne.");
        return;
      }
      throw error;
    }

    const author = interaction.inCachedGuild() ? interaction.member.displayName : interaction.user.displayName;
    const announce = note ? `Marqueur sur ${found.name} : ${note}` : `Marqueur posé sur ${found.name}`;
    let chatWarning = "";
    try {
      await frm.sendChatMessage(gameSenderName(author), announce);
    } catch (error) {
      console.warn("/ping : annonce dans le chat impossible :", error instanceof Error ? error.message : error);
      chatWarning = "\n⚠️ L'annonce dans le chat du jeu n'a pas pu être envoyée.";
    }

    const noteText = note ? ` : « ${escapeMarkdown(note)} »` : "";
    await interaction.editReply(`📍 Marqueur posé en jeu sur ${escapeMarkdown(placeLabel(found))}${noteText}${chatWarning}`);
  },

  async autocomplete(interaction) {
    const [named, players] = await Promise.all([forAutocomplete(cachedNamedPlaces), forAutocomplete(cachedPlayers)]);
    const places = [...(named ?? []), ...playerPlaces(players ?? [])];
    await interaction.respond(suggestions(placeCandidates(places), interaction.options.getFocused()));
  },
};
