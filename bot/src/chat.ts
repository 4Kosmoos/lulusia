// Pont entre le chat du jeu et le salon #chat-jeu.
//  - Jeu -> Discord : lecture de getChatMessages toutes les quelques secondes
//    (messages des joueurs et messages système : connexions, déconnexions…).
//  - Discord -> jeu : envoi par sendChatMessage (demande FRM_TOKEN).

import { ChannelType, Events, escapeMarkdown, type Client, type Message, type TextChannel } from "discord.js";
import { config } from "./config.ts";
import { frm, type ChatMessage } from "./frm.ts";

/** Préfixe des messages venant de Discord : il sert aussi à ne pas les renvoyer vers Discord. */
const DISCORD_PREFIX = "[Discord] ";
const MAX_SENDER_LENGTH = 32; // limite de FRM
const MAX_GAME_MESSAGE_LENGTH = 250;
const MAX_REMEMBERED = 1000;

const seen = new Set<string>();
let baselineDone = false;
let frmDown = false;

/** Nom affiché dans le chat du jeu pour un message venu de Discord (pont du chat, /ping). */
export function gameSenderName(discordName: string): string {
  return `${DISCORD_PREFIX}${discordName}`.slice(0, MAX_SENDER_LENGTH);
}

const keyOf = (m: ChatMessage) => `${m.ServerTimeStamp}|${m.Sender}|${m.Message}`;

function remember(key: string): void {
  seen.add(key);
  if (seen.size > MAX_REMEMBERED) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

/** Texte à poster sur Discord, ou undefined pour ignorer le message. */
function formatGameMessage(m: ChatMessage): string | undefined {
  const text = m.Message.trim();
  if (!text) return undefined;
  if (m.Type === "Player") {
    // Les messages venus de Discord reviennent dans le chat du jeu : on ne les renvoie pas.
    if (m.Sender.startsWith(DISCORD_PREFIX)) return undefined;
    return `🎮 **${escapeMarkdown(m.Sender)}** : ${escapeMarkdown(text)}`;
  }
  if (m.Type === "System") return `⚙️ *${escapeMarkdown(text)}*`;
  return undefined; // messages d'ADA : ignorés
}

async function pollGameChat(channel: TextChannel): Promise<void> {
  let messages: ChatMessage[];
  try {
    messages = await frm.chatMessages();
    if (frmDown) console.log("Chat du jeu : FRM répond de nouveau.");
    frmDown = false;
  } catch (error) {
    if (!frmDown) console.warn("Chat du jeu : lecture impossible :", error instanceof Error ? error.message : error);
    frmDown = true;
    return;
  }

  const fresh = messages
    .filter((m) => !seen.has(keyOf(m)))
    .sort((a, b) => a.ServerTimeStamp - b.ServerTimeStamp);
  for (const m of fresh) remember(keyOf(m));

  // Premier passage : on mémorise l'historique existant sans le renvoyer.
  if (!baselineDone) {
    baselineDone = true;
    return;
  }

  for (const m of fresh) {
    const content = formatGameMessage(m);
    if (content) await channel.send({ content, allowedMentions: { parse: [] } });
  }
}

async function forwardToGame(message: Message): Promise<void> {
  if (message.channelId !== config.chatChannelId) return;
  if (message.author.bot || message.webhookId) return;

  let text = message.cleanContent.replace(/\s+/g, " ").trim();
  if (message.attachments.size > 0) {
    text = `${text} [${message.attachments.size} pièce(s) jointe(s) sur Discord]`.trim();
  }
  if (!text) return;
  if (text.length > MAX_GAME_MESSAGE_LENGTH) text = `${text.slice(0, MAX_GAME_MESSAGE_LENGTH - 1)}…`;

  const sender = gameSenderName(message.member?.displayName ?? message.author.displayName);

  try {
    await frm.sendChatMessage(sender, text);
    await message.react("✅").catch(() => undefined); // facultatif : demande la permission « Ajouter des réactions »
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("Chat du jeu : envoi impossible :", reason);
    await message
      .reply({ content: `⚠️ Message non transmis au jeu : ${reason}`, allowedMentions: { repliedUser: false } })
      .catch(() => undefined);
  }
}

export async function startChatBridge(client: Client<true>): Promise<void> {
  if (!config.chatChannelId) {
    console.log("Pont du chat désactivé (CHAT_CHANNEL_ID absent du .env).");
    return;
  }
  const channel = await client.channels.fetch(config.chatChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`CHAT_CHANNEL_ID (${config.chatChannelId}) n'est pas un salon textuel accessible au bot`);
  }
  if (!config.frmToken) {
    console.warn("FRM_TOKEN absent : le chat du jeu arrivera sur Discord, mais pas l'inverse.");
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
      console.error("Chat du jeu : envoi vers Discord impossible :", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, config.chatPollMs);
  console.log(`Pont du chat actif avec #${channel.name}.`);
}
