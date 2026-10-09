// Outils communs aux commandes : forme d'une commande, cache, autocomplétion.

import { setTimeout as delay } from "node:timers/promises";
import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { normalize } from "../format.ts";

export interface Command {
  /** Définition envoyée à Discord (nom, description, options). */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Suggestions pendant la saisie d'une option. Discord exige une réponse en moins de 3 s. */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** Délai laissé à FRM pendant l'autocomplétion, pour répondre à Discord à temps. */
const AUTOCOMPLETE_TIMEOUT_MS = 2000;
const MAX_CHOICES = 25; // limite de Discord
const MAX_CHOICE_LENGTH = 100; // limite de Discord, pour le nom comme pour la valeur

/**
 * Garde le résultat de `load` pendant `ttlMs`. Les appels simultanés partagent la même requête,
 * pour ne pas solliciter FRM à chaque touche tapée.
 */
export function cached<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let value: T | undefined;
  let loadedAt = 0;
  let pending: Promise<T> | undefined;
  return () => {
    if (value !== undefined && Date.now() - loadedAt < ttlMs) return Promise.resolve(value);
    pending ??= load()
      .then((result) => {
        value = result;
        loadedAt = Date.now();
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

/**
 * Données pour l'autocomplétion, ou undefined si FRM est trop lent ou en panne.
 * La requête continue en arrière-plan et remplit le cache pour la touche suivante.
 */
export async function forAutocomplete<T>(load: () => Promise<T>): Promise<T | undefined> {
  const request = load().catch(() => undefined);
  const timeout = delay(AUTOCOMPLETE_TIMEOUT_MS, undefined, { ref: false });
  return Promise.race([request, timeout]);
}

export interface Candidate {
  /** Texte affiché dans la liste de Discord. */
  label: string;
  /** Identifiant renvoyé au bot quand le joueur choisit cette entrée. */
  value: string;
  /** Texte sur lequel porte la recherche. */
  search: string;
}

/** Pertinence d'un nom pour une recherche : début du nom, puis début d'un mot, puis n'importe où. */
function score(search: string, query: string): number {
  if (!query) return 1;
  const text = normalize(search);
  if (text.startsWith(query)) return 3;
  if (text.includes(` ${query}`)) return 2;
  return text.includes(query) ? 1 : 0;
}

/**
 * Les meilleures suggestions pour ce que le joueur a tapé, dans le format attendu par Discord.
 * À pertinence égale, l'ordre des candidats est conservé.
 */
export function suggestions(candidates: Candidate[], typed: string): ApplicationCommandOptionChoiceData<string>[] {
  const query = normalize(typed);
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate.search, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHOICES)
    .map(({ candidate }) => ({
      name: candidate.label.slice(0, MAX_CHOICE_LENGTH),
      value: candidate.value.slice(0, MAX_CHOICE_LENGTH),
    }));
}

/**
 * Retrouve ce que le joueur a choisi : par identifiant s'il a pris une suggestion, sinon par le nom tapé
 * (nom exact, ou seul nom qui contient le texte). Renvoie aussi les noms possibles si c'est ambigu.
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
