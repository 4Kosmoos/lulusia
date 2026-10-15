// Bridge between the game chat and a Discord channel (CHAT_CHANNEL_ID).
//  - Game -> Discord: reads getChatMessages every few seconds (player messages and system messages,
//    except joins and leaves: FRM sends them without the player's name, and /players covers them).
//  - Discord -> game: sent with sendChatMessage (needs FRM_TOKEN).
//  - Commands ("!stock", "!power"…) typed on either side: answered in the game and in the bridge channel.

import { ChannelType, Events, escapeMarkdown, type Client, type Message, type TextChannel } from "discord.js";
import { discordPayload, runGameCommand } from "./commands/index.ts";
import { config } from "./config.ts";
import { frm, type ChatMessage } from "./frm.ts";
import { MAX_GAME_MESSAGE_LENGTH, discordSender, isFromBot } from "./game-chat.ts";

const MAX_REMEMBERED = 1000;

/** "<PlayerName/> has joined the game!": FRM does not replace the name tag, and /players covers it. */
const JOIN_LEAVE = /has (joined|left) the game|a (rejoint|quitté) la partie/i;

const seen = new Set<string>();
let baselineDone = false;
let frmDown = false;

const keyOf = (m: ChatMessage) => `${m.ServerTimeStamp}|${m.Sender}|${m.Message}`;

function remember(key: string): void {
  seen.add(key);
  if (seen.size > MAX_REMEMBERED) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

/** Text to post on Discord, or undefined to ignore the message. */
function formatGameMessage(m: ChatMessage): string | undefined {
  const text = m.Message.trim();
  if (!text) return undefined;
  if (m.Type === "Player") {
    if (isFromBot(m.Sender)) return undefined;
    return `🎮 **${escapeMarkdown(m.Sender)}**: ${escapeMarkdown(text)}`;
  }
  if (m.Type === "System") {
    if (JOIN_LEAVE.test(text)) return undefined;
    // The game replaces this tag with the player's name itself: FRM sends it as is.
    const resolved = text.replaceAll("<PlayerName/>", m.Sender || "a pioneer");
    return `⚙️ *${escapeMarkdown(resolved)}*`;
  }
  return undefined; // ADA messages: ignored
}

async function pollGameChat(channel: TextChannel): Promise<void> {
  let messages: ChatMessage[];
  try {
    messages = await frm.chatMessages();
    if (frmDown) console.log("Game chat: FRM is answering again.");
    frmDown = false;
  } catch (error) {
    if (!frmDown) console.warn("Game chat: cannot read:", error instanceof Error ? error.message : error);
    frmDown = true;
    return;
  }

  const fresh = messages
    .filter((m) => !seen.has(keyOf(m)))
    .sort((a, b) => a.ServerTimeStamp - b.ServerTimeStamp);
  for (const m of fresh) remember(keyOf(m));

  // First pass: remember the existing history without posting it again.
  if (!baselineDone) {
    baselineDone = true;
    return;
  }

  for (const m of fresh) {
    const content = formatGameMessage(m);
    if (content) await channel.send({ content, allowedMentions: { parse: [] } });
    if (m.Type === "Player" && !isFromBot(m.Sender)) await answerCommand(channel, m.Message.trim(), m.Sender);
  }
}

/** If the message is a command ("!stock iron plate"), answers in the game and in the bridge channel. */
async function answerCommand(channel: TextChannel, text: string, author: string): Promise<void> {
  try {
    const result = await runGameCommand(text, author);
    if (result) await channel.send({ ...discordPayload(result.discord), allowedMentions: { parse: [] } });
  } catch (error) {
    console.warn(`Command "${text}": cannot answer:`, error instanceof Error ? error.message : error);
  }
}

async function forwardToGame(message: Message): Promise<void> {
  if (message.channelId !== config.chatChannelId) return;
  if (message.author.bot || message.webhookId) return;

  let text = message.cleanContent.replace(/\s+/g, " ").trim();
  if (message.attachments.size > 0) {
    const files = message.attachments.size === 1 ? "1 attachment" : `${message.attachments.size} attachments`;
    text = `${text} [${files} on Discord]`.trim();
  }
  if (!text) return;
  if (text.length > MAX_GAME_MESSAGE_LENGTH) text = `${text.slice(0, MAX_GAME_MESSAGE_LENGTH - 1)}…`;

  const author = message.member?.displayName ?? message.author.displayName;

  try {
    await frm.sendChatMessage(discordSender(author), text);
    await message.react("✅").catch(() => undefined); // optional: needs the "Add Reactions" permission
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("Game chat: cannot send:", reason);
    await message
      .reply({ content: `⚠️ Message not delivered to the game: ${reason}`, allowedMentions: { repliedUser: false } })
      .catch(() => undefined);
    return;
  }
  if (message.channel.type === ChannelType.GuildText) await answerCommand(message.channel, text, author);
}

export async function startChatBridge(client: Client<true>): Promise<void> {
  if (!config.chatChannelId) {
    console.log("Chat bridge disabled (CHAT_CHANNEL_ID missing from .env).");
    return;
  }
  const channel = await client.channels.fetch(config.chatChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`CHAT_CHANNEL_ID (${config.chatChannelId}) is not a text channel the bot can access`);
  }
  if (!config.frmToken) {
    console.warn("FRM_TOKEN missing: the game chat will reach Discord, but not the other way around.");
  }

  client.on(Events.MessageCreate, (message) => {
    void forwardToGame(message);
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollGameChat(channel);
    } catch (error) {
      console.error("Game chat: cannot post to Discord:", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, config.chatPollMs);
  console.log(`Chat bridge active with #${channel.name}.`);
}
