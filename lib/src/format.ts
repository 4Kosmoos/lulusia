// Number and duration formatting, in the game's language (English): 1,234.5, 50.4%, 2h 05m.

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1,234.5 */
export const formatNumber = (value: number): string => decimal.format(value);
/** 1,235 */
export const formatInteger = (value: number): string => whole.format(value);
/** 1,234.5 MW */
export const mw = (value: number): string => `${decimal.format(value)} MW`;
/** 50.4% */
export const percent = (value: number): string => `${decimal.format(value)}%`;

/** "1 circuit", "3 circuits" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : pluralForm}`;
}

/** First letter in upper case. */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Duration in minutes → "45 min", "2h 05m", "3d 4h". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours}h ${String(total % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
