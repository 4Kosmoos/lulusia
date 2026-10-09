// Commandes du bot : enregistrement sur Discord, et exécution depuis Discord (/stock) ou depuis le chat du jeu (!stock).

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type EmbedBuilder,
  type Interaction,
} from "discord.js";
import { config } from "../config.ts";
import { normalize } from "../format.ts";
import { FrmError } from "../frm.ts";
import { botSays } from "../game-chat.ts";
import { energie } from "./energie.ts";
import { joueurs } from "./joueurs.ts";
import { ping } from "./ping.ts";
import type { Command, CommandResult } from "./shared.ts";
import { stock } from "./stock.ts";

const commands: Command[] = [stock, energie, joueurs, ping];
const byName = new Map(commands.map((command) => [command.data.name, command]));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Réponse Discord d'une commande, prête pour `send` ou `editReply`. */
export function discordPayload(discord: string | EmbedBuilder) {
  return typeof discord === "string" ? { content: discord, embeds: [] } : { embeds: [discord] };
}

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

// ---------------------------------------------------------------------------------------------
// Depuis Discord

async function runSlashCommand(interaction: ChatInputCommandInteraction, command: Command): Promise<void> {
  await interaction.deferReply();
  const options = Object.fromEntries(
    (command.data.options ?? []).map((option) => [option.name, interaction.options.getString(option.name) ?? undefined]),
  );
  const author = interaction.inCachedGuild() ? interaction.member.displayName : interaction.user.displayName;
  const result = await command.run({ options, author });
  await interaction.editReply(discordPayload(result.discord));

  // Lancée dans le salon du pont : le résultat est aussi recopié dans le chat du jeu.
  if (interaction.channelId === config.chatChannelId && result.game.length > 0) {
    await botSays(result.game).catch((error) =>
      console.warn(`/${command.data.name} : recopie dans le chat du jeu impossible :`, errorText(error)),
    );
  }
}

async function replyWithError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
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
      console.warn(`Autocomplétion /${interaction.commandName} :`, errorText(error));
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = byName.get(interaction.commandName);
  if (!command) return;
  try {
    await runSlashCommand(interaction, command);
  } catch (error) {
    await replyWithError(interaction, error);
  }
}

// ---------------------------------------------------------------------------------------------
// Depuis le chat du jeu

function gameHelp(): CommandResult {
  const usages = commands.flatMap((command) => (command.gameUsage ? [command.gameUsage] : []));
  return {
    discord: `Commandes du chat du jeu : ${usages.map((usage) => `\`${usage}\``).join(", ")}`,
    game: [`Commandes : ${usages.join(" | ")}`],
  };
}

async function runInGame(command: Command, argument: string, author: string): Promise<CommandResult> {
  const usage = { discord: `Utilisation : \`${command.gameUsage}\``, game: [`Utilisation : ${command.gameUsage}`] };
  // Le texte tapé après le nom de la commande va dans sa première option.
  const option = command.data.options?.[0];
  if (option && "required" in option && option.required && !argument) return usage;
  try {
    return await command.run({ options: option ? { [option.name]: argument } : {}, author });
  } catch (error) {
    if (!(error instanceof FrmError)) console.error(`!${command.data.name} :`, error);
    const reason = error instanceof FrmError ? error.message : "erreur inattendue, voir les logs du bot";
    return { discord: `⚠️ ${reason}`, game: [`Erreur : ${reason}`] };
  }
}

/**
 * Message du chat du jeu qui commence par « ! » : exécute la commande et répond dans le jeu.
 * Renvoie le résultat pour le salon du pont, ou undefined si le message n'est pas une commande du bot.
 */
export async function runGameCommand(text: string, author: string): Promise<CommandResult | undefined> {
  if (!text.startsWith("!")) return undefined;
  const [first = "", ...rest] = text.slice(1).trim().split(/\s+/);
  const name = normalize(first);

  let result: CommandResult;
  if (name === "aide" || name === "help") {
    result = gameHelp();
  } else {
    const command = byName.get(name);
    if (!command?.gameUsage) return undefined; // un « ! » qui n'est pas une commande : message normal
    result = await runInGame(command, rest.join(" "), author);
  }
  await botSays(result.game);
  return result;
}
