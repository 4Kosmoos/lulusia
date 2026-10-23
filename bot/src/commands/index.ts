// Bot commands: registration on Discord, and execution from Discord (/stock) or from the game chat (!stock).

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type EmbedBuilder,
  type Interaction,
} from "discord.js";
import { FrmError } from "@lulusia/lib/frm";
import { normalize } from "@lulusia/lib/search";
import { config } from "../config.ts";
import { botSays } from "../game-chat.ts";
import { alert } from "./alert.ts";
import { machines } from "./machines.ts";
import { ping } from "./ping.ts";
import { players } from "./players.ts";
import { power } from "./power.ts";
import type { Command, CommandArgs, CommandResult } from "./shared.ts";
import { stock } from "./stock.ts";
import { switchCommand } from "./switch.ts";

const commands: Command[] = [stock, power, players, ping, alert, switchCommand, machines];
const byName = new Map(commands.map((command) => [command.data.name, command]));
/** Game chat shortcuts: "!alerts" = "!alert list", "!switches" = "!switch list". */
const GAME_ALIASES: Record<string, string> = { alerts: "alert list", switches: "switch list" };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Discord answer of a command, ready for `send` or `editReply`. */
export function discordPayload(discord: string | EmbedBuilder) {
  return typeof discord === "string" ? { content: discord, embeds: [] } : { embeds: [discord] };
}

/**
 * Registers the commands on the Discord server of the #statut channel. A server command is
 * available right away (a global command can take a while to show up).
 * `set` replaces the whole list: a command removed from the code also disappears from Discord.
 */
export async function registerCommands(client: Client<true>): Promise<void> {
  const channel = await client.channels.fetch(config.statusChannelId);
  if (!channel || channel.isDMBased()) {
    throw new Error(`STATUS_CHANNEL_ID (${config.statusChannelId}) is not a server channel the bot can access`);
  }
  await channel.guild.commands.set(commands.map((command) => command.data));
  console.log(`Commands registered: ${commands.map((command) => `/${command.data.name}`).join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// From Discord

/** Subcommand and options of a slash command, all converted to text (as in the game). */
function readArgs(interaction: ChatInputCommandInteraction): CommandArgs {
  const subcommand = interaction.options.getSubcommand(false) ?? undefined;
  const given = subcommand ? (interaction.options.data[0]?.options ?? []) : interaction.options.data;
  return {
    subcommand,
    options: Object.fromEntries(given.map((option) => [option.name, option.value === undefined ? undefined : String(option.value)])),
  };
}

async function runSlashCommand(interaction: ChatInputCommandInteraction, command: Command): Promise<void> {
  await interaction.deferReply();
  const author = interaction.inCachedGuild() ? interaction.member.displayName : interaction.user.displayName;
  const result = await command.run({ ...readArgs(interaction), author });
  await interaction.editReply(discordPayload(result.discord));

  // Run in the bridge channel, or an action to announce: the result also goes to the game chat.
  if ((interaction.channelId === config.chatChannelId || result.announce) && result.game.length > 0) {
    await botSays(result.game).catch((error) =>
      console.warn(`/${command.data.name}: cannot copy to the game chat:`, errorText(error)),
    );
  }
}

async function replyWithError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
  let content = "⚠️ Unexpected error, see the bot logs.";
  if (error instanceof FrmError) {
    content = `⚠️ FRM is not responding: ${error.message}`;
    console.warn(`/${interaction.commandName}:`, error.message);
  } else {
    console.error(`/${interaction.commandName}:`, error);
  }
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [] });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    // Interaction expired: nothing more to do.
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    try {
      await byName.get(interaction.commandName)?.autocomplete?.(interaction);
    } catch (error) {
      // Usually a suggestion that arrived too late (the player kept typing): harmless.
      console.warn(`Autocomplete /${interaction.commandName}:`, errorText(error));
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
// From the game chat

function gameHelp(): CommandResult {
  const usages = commands.flatMap((command) => (command.gameUsage ? [command.gameUsage] : []));
  return {
    discord: `Game chat commands: ${usages.map((usage) => `\`${usage}\``).join(", ")}`,
    game: [`Commands: ${usages.join(" | ")}`],
  };
}

/** By default, the text typed after the command name goes into its first option. */
function defaultGameArgs(command: Command, argument: string): CommandArgs | undefined {
  const option = command.data.options?.[0];
  if (option && "required" in option && option.required && !argument) return undefined;
  return { options: option ? { [option.name]: argument } : {} };
}

async function runInGame(command: Command, argument: string, author: string): Promise<CommandResult> {
  const args = command.parseGame ? command.parseGame(argument) : defaultGameArgs(command, argument);
  if (!args) return { discord: `Usage: \`${command.gameUsage}\``, game: [`Usage: ${command.gameUsage}`] };
  try {
    return await command.run({ ...args, author });
  } catch (error) {
    if (!(error instanceof FrmError)) console.error(`!${command.data.name}:`, error);
    const reason = error instanceof FrmError ? error.message : "unexpected error, see the bot logs";
    return { discord: `⚠️ ${reason}`, game: [`Error: ${reason}`] };
  }
}

/**
 * Game chat message starting with "!": runs the command and answers in the game.
 * Returns the result for the bridge channel, or undefined if the message is not a bot command.
 */
export async function runGameCommand(text: string, author: string): Promise<CommandResult | undefined> {
  if (!text.startsWith("!")) return undefined;
  let [first = "", ...rest] = text.slice(1).trim().split(/\s+/);
  const alias = GAME_ALIASES[normalize(first)];
  if (alias) [first = "", ...rest] = [...alias.split(" "), ...rest];
  const name = normalize(first);

  let result: CommandResult;
  if (name === "help") {
    result = gameHelp();
  } else {
    const command = byName.get(name);
    if (!command?.gameUsage) return undefined; // a "!" that is not a command: normal message
    result = await runInGame(command, rest.join(" "), author);
  }
  await botSays(result.game);
  return result;
}
