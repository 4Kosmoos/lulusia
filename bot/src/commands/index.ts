// Commandes slash : enregistrement sur le serveur Discord et aiguillage des interactions.

import { MessageFlags, type Client, type Interaction } from "discord.js";
import { config } from "../config.ts";
import { FrmError } from "../frm.ts";
import { energie } from "./energie.ts";
import { joueurs } from "./joueurs.ts";
import { ping } from "./ping.ts";
import type { Command } from "./shared.ts";
import { stock } from "./stock.ts";

const commands: Command[] = [stock, energie, joueurs, ping];
const byName = new Map(commands.map((command) => [command.data.name, command]));

/**
 * Déclare les commandes sur le serveur Discord du salon #statut. Une commande de serveur est
 * disponible tout de suite (une commande globale peut mettre du temps à apparaître).
 * `set` remplace toute la liste : une commande retirée du code disparaît aussi de Discord.
 */
export async function registerCommands(client: Client<true>): Promise<void> {
  const channel = await client.channels.fetch(config.statusChannelId);
  if (!channel || channel.isDMBased()) {
    throw new Error(`STATUS_CHANNEL_ID (${config.statusChannelId}) n'est pas un salon de serveur accessible au bot`);
  }
  await channel.guild.commands.set(commands.map((command) => command.data));
  console.log(`Commandes enregistrées : ${commands.map((command) => `/${command.data.name}`).join(", ")}`);
}

async function replyWithError(interaction: Interaction, error: unknown): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  let content = "⚠️ Erreur inattendue, voir les logs du bot.";
  if (error instanceof FrmError) {
    content = `⚠️ FRM ne répond pas : ${error.message}`;
    console.warn(`/${interaction.commandName} :`, error.message);
  } else {
    console.error(`/${interaction.commandName} :`, error);
  }
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [] });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    // Interaction expirée : rien de plus à faire.
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    try {
      await byName.get(interaction.commandName)?.autocomplete?.(interaction);
    } catch (error) {
      // Souvent une suggestion arrivée trop tard (le joueur a continué à taper) : sans gravité.
      console.warn(`Autocomplétion /${interaction.commandName} :`, error instanceof Error ? error.message : error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = byName.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    await replyWithError(interaction, error);
  }
}
