// Pont entre le chat du jeu et le salon #chat-jeu.
//  - Jeu -> Discord : lecture de getChatMessages toutes les quelques secondes
//    (messages des joueurs et messages système, sauf les connexions et déconnexions,
//    déjà annoncées dans #alertes par FRM).
//  - Discord -> jeu : envoi par sendChatMessage (demande FRM_TOKEN).
//  - Commandes « !stock », « !energie »… tapées d'un côté ou de l'autre : réponse dans le jeu et dans #chat-jeu.

import { ChannelType, Events, escapeMarkdown, type Client, type Message, type TextChannel } from "discord.js";
import { discordPayload, runGameCommand } from "./commands/index.ts";
import { config } from "./config.ts";
import { frm, type ChatMessage } from "./frm.ts";
import { MAX_GAME_MESSAGE_LENGTH, discordSender, isFromBot } from "./game-chat.ts";

const MAX_REMEMBERED = 1000;

/** « <PlayerName/> has joined the game! » : déjà annoncé dans #alertes, et FRM ne remplace pas le nom. */
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

/** Texte à poster sur Discord, ou undefined pour ignorer le message. */
function formatGameMessage(m: ChatMessage): string | undefined {
  const text = m.Message.trim();
  if (!text) return undefined;
  if (m.Type === "Player") {
    if (isFromBot(m.Sender)) return undefined;
    return `🎮 **${escapeMarkdown(m.Sender)}** : ${escapeMarkdown(text)}`;
  }
  if (m.Type === "System") {
    if (JOIN_LEAVE.test(text)) return undefined;
    // Le jeu remplace lui-même cette balise par le nom du joueur concerné : FRM la renvoie telle quelle.
    const resolved = text.replaceAll("<PlayerName/>", m.Sender || "un pionnier");
    return `⚙️ *${escapeMarkdown(resolved)}*`;
  }
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
    if (m.Type === "Player" && !isFromBot(m.Sender)) await answerCommand(channel, m.Message.trim(), m.Sender);
  }
}

/** Si le message est une commande (« !stock iron plate »), répond dans le jeu et dans #chat-jeu. */
async function answerCommand(channel: TextChannel, text: string, author: string): Promise<void> {
  try {
    const result = await runGameCommand(text, author);
    if (result) await channel.send({ ...discordPayload(result.discord), allowedMentions: { parse: [] } });
  } catch (error) {
    console.warn(`Commande « ${text} » : réponse impossible :`, error instanceof Error ? error.message : error);
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

  const author = message.member?.displayName ?? message.author.displayName;

  try {
    await frm.sendChatMessage(discordSender(author), text);
    await message.react("✅").catch(() => undefined); // facultatif : demande la permission « Ajouter des réactions »
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("Chat du jeu : envoi impossible :", reason);
    await message
      .reply({ content: `⚠️ Message non transmis au jeu : ${reason}`, allowedMentions: { repliedUser: false } })
      .catch(() => undefined);
    return;
  }
  if (message.channel.type === ChannelType.GuildText) await answerCommand(message.channel, text, author);
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
