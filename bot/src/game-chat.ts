// Writing to the game chat through FRM: sender names, and text the game's font can display.

import { frm } from "./frm.ts";

/** Prefix of messages coming from Discord (chat bridge, /ping). */
const DISCORD_PREFIX = "[Discord] ";
/** The bot's name in the game chat, in FICSIT orange. */
const BOT_SENDER = "Lulusia";
const BOT_COLOR = { r: 0.98, g: 0.58, b: 0.14, a: 1 };
const MAX_SENDER_LENGTH = 32; // FRM limit
export const MAX_GAME_MESSAGE_LENGTH = 250;

/** Name shown in the game chat for a message coming from Discord. */
export function discordSender(discordName: string): string {
  return `${DISCORD_PREFIX}${discordName}`.slice(0, MAX_SENDER_LENGTH);
}

/**
 * True for messages written by the bot or coming from Discord: FRM returns them in the game chat
 * like players' messages, and they must not be sent back to Discord.
 */
export function isFromBot(sender: string): boolean {
  return sender === BOT_SENDER || sender.startsWith(DISCORD_PREFIX);
}

/** Text the game's font can display: no emoji, and non-breaking spaces replaced with spaces. */
export function forGame(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Queue: the lines of two answers sent at the same time do not get mixed up in the game. */
let queue: Promise<void> = Promise.resolve();

/** The bot writes in the game chat, one message per line. */
export function botSays(lines: string[]): Promise<void> {
  const send = async () => {
    for (const line of lines) {
      const text = forGame(line).slice(0, MAX_GAME_MESSAGE_LENGTH);
      if (text) await frm.sendChatMessage(BOT_SENDER, text, BOT_COLOR);
    }
  };
  const done = queue.then(send);
  queue = done.catch(() => undefined);
  return done;
}
