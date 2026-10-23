// item_report: everything about one item, and finding an item from what the user typed.

import { findItem, minutesUntilEmpty, reportFor, type Inventory, type Item } from "@lulusia/lib/inventory";
import { normalize } from "@lulusia/lib/search";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, fail, ok, round, withFrm } from "../result.ts";
import { MachineGroupView, Unit, groupsFor } from "../views.ts";

const MAX_SUGGESTIONS = 10;

export const ItemInput = z
  .string()
  .min(1)
  .describe("The item's English name in the game, exact or a unique part of it (\"reinforced iron\")");

/**
 * The item the user means, or a tool error listing the candidates: names containing the text if it is
 * ambiguous, otherwise the names sharing the most words with it.
 */
export function pickItem(inventory: Inventory, typed: string): Item | CallToolResult {
  const { found, ambiguous } = findItem(inventory.items, typed);
  if (found) return found;
  if (ambiguous.length > 0) {
    return fail(`Several items match "${typed}": ${ambiguous.join(", ")}. Call again with one of these names.`);
  }
  const words = normalize(typed).split(/\s+/).filter((word) => word.length > 2);
  const close = inventory.items
    .map((item) => ({ name: item.name, shared: words.filter((word) => normalize(item.name).includes(word)).length }))
    .filter((candidate) => candidate.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.name);
  return fail(
    `No item named "${typed}" in storage or production.` +
      (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " The stock tool lists the items in storage."),
  );
}

const isItem = (value: Item | CallToolResult): value is Item => "className" in value;

const ItemReportOutput = z.object({
  item: z.string(),
  unit: Unit,
  stock: z.object({ containers: z.number(), dimensionalDepot: z.number(), total: z.number() }),
  /** Absent if no machine, extractor or generator makes or uses the item right now. */
  rates: z
    .object({
      producedPerMin: z.number(),
      maxProducedPerMin: z.number(),
      consumedPerMin: z.number(),
      maxConsumedPerMin: z.number(),
      netPerMin: z.number(),
    })
    .optional(),
  minutesUntilEmpty: z.number().optional(),
  /** Production machines that make it (extractors are not included), grouped by recipe. */
  madeBy: z.array(MachineGroupView),
  usedBy: z.array(MachineGroupView),
});

export function registerItemReport(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "item_report",
    {
      title: "Item report",
      description:
        "Everything about one item: stock (containers and dimensional depot), production and consumption per " +
        "minute (now and at full speed), net balance, time before the stock runs out, and the machines that make " +
        "or use it, grouped by recipe, with each recipe's inputs and outputs per machine at 100% clock speed. " +
        "Use it to follow a production chain step by step, or to see the recipes the factory uses for an item.",
      inputSchema: z.object({ item: ItemInput }),
      outputSchema: ItemReportOutput,
      annotations: READ_ONLY,
    },
    ({ item: typed }) =>
      withFrm(async () => {
        const [inventory, machines] = await Promise.all([data.inventory(), data.machines()]);
        const item = pickItem(inventory, typed);
        if (!isItem(item)) return item;
        const report = reportFor(inventory, item);
        const minutes = minutesUntilEmpty(report);
        const output: z.infer<typeof ItemReportOutput> = {
          item: report.name,
          unit: report.fluid ? "m³" : "items",
          stock: {
            containers: Math.round(report.inStorage),
            dimensionalDepot: Math.round(report.inDepot),
            total: Math.round(report.total),
          },
          ...(report.stat && {
            rates: {
              producedPerMin: round(report.stat.CurrentProd),
              maxProducedPerMin: round(report.stat.MaxProd),
              consumedPerMin: round(report.stat.CurrentConsumed),
              maxConsumedPerMin: round(report.stat.MaxConsumed),
              netPerMin: round(report.balance),
            },
          }),
          ...(minutes !== undefined && { minutesUntilEmpty: Math.round(minutes) }),
          madeBy: groupsFor(machines, item.className, "made"),
          usedBy: groupsFor(machines, item.className, "used"),
        };
        return ok(output);
      }),
  );
}
