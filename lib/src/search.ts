// Finding what a person typed among the game's names: accents and capitals ignored, partial names accepted.

/** Text without accents or capitals, to compare what a person types with the game's names. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/**
 * Relevance of a name for a normalized query: 3 if the name starts with it, 2 if a word starts with it,
 * 1 if it appears anywhere (or if the query is empty), 0 if it does not match.
 */
export function relevance(name: string, query: string): number {
  if (!query) return 1;
  const text = normalize(name);
  if (text.startsWith(query)) return 3;
  if (text.includes(` ${query}`)) return 2;
  return text.includes(query) ? 1 : 0;
}

/**
 * Finds what the person chose: by identifier (a picked suggestion), otherwise by the name typed
 * (exact name, or the only name containing the text). Also returns the possible names if it is ambiguous.
 */
export function resolve<T>(
  items: T[],
  typed: string,
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
): { found?: T; ambiguous: string[] } {
  const byId = items.find((item) => idOf(item) === typed);
  if (byId) return { found: byId, ambiguous: [] };

  const query = normalize(typed);
  const exact = items.find((item) => normalize(nameOf(item)) === query);
  if (exact) return { found: exact, ambiguous: [] };

  const partial = query ? items.filter((item) => normalize(nameOf(item)).includes(query)) : [];
  if (partial.length === 1) return { found: partial[0], ambiguous: [] };
  return { ambiguous: [...new Set(partial.map(nameOf))].slice(0, 10) };
}
