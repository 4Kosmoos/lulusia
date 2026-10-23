// Prompts: ready-made requests that the user picks in Claude's menu (the model picks the tools itself).

import type { GetPromptResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const language = z.string().optional().describe("Language of the answer (default: French)");

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "factory_checkup",
    {
      title: "Factory checkup",
      description: "A short report on the factory: power, deficits, stopped machines, and what to do first",
      argsSchema: z.object({ language }),
    },
    ({ language }) =>
      userMessage(
        [
          "Give me a checkup of the Lulusia factory, from its live data.",
          "Start with factory_overview, then dig with power, production_balance and machines (state: stopped) " +
            "where something looks wrong.",
          "Report, briefly: the power situation; the deficits and their cause (follow the chain with item_report " +
            "when it helps); the stopped machines and why, grouped by cause; then the three actions that would " +
            "help most, in order.",
          "Machines stopped because their output is full usually mean full storage or a backed-up belt, not a " +
          "problem in themselves.",
          `Answer in ${language ?? "French"}, keeping the game's English names for items and buildings.`,
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "plan_production",
    {
      title: "Plan a production line",
      description: "Plan a new production line for an item, from the recipes and surpluses of the factory",
      argsSchema: z.object({
        item: z.string().describe("The item to make (English name)"),
        rate: z.string().describe("How many per minute"),
        language,
      }),
    },
    ({ item, rate, language }) =>
      userMessage(
        [
          `Plan a production line for ${rate} ${item} per minute in the Lulusia factory.`,
          "The mod pack (Satisfactory Plus) changes many recipes: use the recipes the factory already uses " +
            "(item_report on the item and on each ingredient, or machines with the item filter), with their rates " +
            "per machine at 100%. If a step has no recipe in use, say so and mark any recipe you assume.",
          "Reuse what exists: check production_balance for surpluses that can feed the line, and power for the " +
            "margin left.",
          "Give, step by step from raw resources: the recipe, the building and how many, the inputs per minute, " +
          "what existing surplus covers, the power needed, and what is missing.",
          `Answer in ${language ?? "French"}, keeping the game's English names for items and buildings.`,
        ].join("\n"),
      ),
  );
}
