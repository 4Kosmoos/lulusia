// Mise en forme commune des messages du bot.

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** 1 234,5 */
export const formatNumber = (value: number): string => decimal.format(value);
/** 1 235 */
export const formatInteger = (value: number): string => whole.format(value);
/** 1 234,5 MW */
export const mw = (value: number): string => `${decimal.format(value)} MW`;

/** « 1 réseau », « 3 réseaux » */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Texte sans accents ni majuscules, pour comparer ce que tape un joueur aux noms du jeu. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Durée en minutes → « 45 min », « 2 h 05 », « 3 j 4 h ». */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours} h ${String(total % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}
