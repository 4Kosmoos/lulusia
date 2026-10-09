// Écriture dans le chat du jeu, via FRM : noms d'expéditeur et texte compatible avec la police du jeu.

import { frm } from "./frm.ts";

/** Préfixe des messages venant de Discord (pont du chat, /ping). */
const DISCORD_PREFIX = "[Discord] ";
/** Nom du bot dans le chat du jeu, en orange FICSIT. */
const BOT_SENDER = "Lulusia";
const BOT_COLOR = { r: 0.98, g: 0.58, b: 0.14, a: 1 };
const MAX_SENDER_LENGTH = 32; // limite de FRM
export const MAX_GAME_MESSAGE_LENGTH = 250;

/** Nom affiché dans le chat du jeu pour un message venu de Discord. */
export function discordSender(discordName: string): string {
  return `${DISCORD_PREFIX}${discordName}`.slice(0, MAX_SENDER_LENGTH);
}

/**
 * Vrai pour les messages écrits par le bot ou venus de Discord : FRM les renvoie dans le chat du jeu
 * comme ceux des joueurs, il ne faut pas les renvoyer vers Discord.
 */
export function isFromBot(sender: string): boolean {
  return sender === BOT_SENDER || sender.startsWith(DISCORD_PREFIX);
}

/** Texte affichable par la police du jeu : sans emoji, et espaces insécables remplacés par des espaces. */
export function forGame(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** File d'attente : les lignes de deux réponses lancées en même temps ne se mélangent pas dans le jeu. */
let queue: Promise<void> = Promise.resolve();

/** Le bot écrit dans le chat du jeu, un message par ligne. */
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
