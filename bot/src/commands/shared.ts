// Shared tools for the commands: shape of a command, autocomplete.

import { setTimeout as delay } from "node:timers/promises";
import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  EmbedBuilder,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { normalize, relevance } from "@lulusia/lib/search";

export interface CommandArgs {
  /** Subcommand ("/alert stock" → "stock"), if any. */
  subcommand?: string;
  /** Value of each option, as text, by name. */
  options: Record<string, string | undefined>;
}

export interface CommandInput extends CommandArgs {
  /** Name of the person running the command, on Discord or in the game. */
  author: string;
}

export interface CommandResult {
  /** Answer on Discord. */
  discord: string | EmbedBuilder;
  /** The same answer for the game chat: one line per message, no Markdown (emoji are removed when sent). */
  game: string[];
  /**
   * Always send `game` to the game chat, wherever the command comes from: for actions that change
   * the game (turning a switch off…), players must know what happens and who did it.
   */
  announce?: boolean;
}

export interface Command {
  /** Definition sent to Discord (name, description, options). */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Usage in the game chat ("!stock <item>"), or undefined if the command is not available there. */
  gameUsage?: string;
  /**
   * Reads the text typed in game after the command name. Without it, the whole text goes into the
   * first option. Returns undefined if the text is not valid: the bot then shows `gameUsage`.
   */
  parseGame?(text: string): CommandArgs | undefined;
  run(input: CommandInput): Promise<CommandResult>;
  /** Suggestions while an option is being typed. Discord requires an answer within 3 s. */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** Time given to FRM during autocomplete, to answer Discord in time. */
const AUTOCOMPLETE_TIMEOUT_MS = 2000;
const MAX_CHOICES = 25; // Discord limit
const MAX_CHOICE_LENGTH = 100; // Discord limit, for the name and for the value

/**
 * Data for autocomplete, or undefined if FRM is too slow or down.
 * The request keeps going in the background and fills the cache for the next key.
 */
export async function forAutocomplete<T>(load: () => Promise<T>): Promise<T | undefined> {
  const request = load().catch(() => undefined);
  const timeout = delay(AUTOCOMPLETE_TIMEOUT_MS, undefined, { ref: false });
  return Promise.race([request, timeout]);
}

export interface Candidate {
  /** Text shown in Discord's list. */
  label: string;
  /** Identifier sent back to the bot when the player picks this entry. */
  value: string;
  /** Text the search applies to. */
  search: string;
}

/**
 * The best suggestions for what the player typed, in the format Discord expects.
 * Candidates with the same relevance keep their order.
 */
export function suggestions(candidates: Candidate[], typed: string): ApplicationCommandOptionChoiceData<string>[] {
  const query = normalize(typed);
  return candidates
    .map((candidate) => ({ candidate, score: relevance(candidate.search, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHOICES)
    .map(({ candidate }) => ({
      name: candidate.label.slice(0, MAX_CHOICE_LENGTH),
      value: candidate.value.slice(0, MAX_CHOICE_LENGTH),
    }));
}
