// stock: what is in storage.

import { reportFor } from "@lulusia/lib/inventory";
import { normalize } from "@lulusia/lib/search";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, ok, withFrm } from "../result.ts";
import { Unit } from "../views.ts";

const StockOutput = z.object({
  items: z.array(
    z.object({
      item: z.string(),
      unit: Unit,
      total: z.number(),
      containers: z.number(),
      dimensionalDepot: z.number(),
    }),
  ),
  /** Items left out by the limit. */
  notShown: z.number(),
});

export function registerStock(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "stock",
    {
      title: "Stock",
      description:
        "What is in storage: the items in the containers and in the dimensional depot, largest amounts first, " +
        "optionally only those whose name contains a text. For one item in detail, use item_report.",
      inputSchema: z.object({
        search: z.string().optional().describe('Part of the English name, e.g. "ingot"'),
        limit: z.number().int().min(1).max(200).default(40),
      }),
      outputSchema: StockOutput,
      annotations: READ_ONLY,
    },
    ({ search, limit }) =>
      withFrm(async () => {
        const inventory = await data.inventory();
        const query = search ? normalize(search) : "";
        const stored = inventory.items
          .filter((item) => normalize(item.name).includes(query))
          .map((item) => reportFor(inventory, item))
          .filter((report) => report.total > 0)
          .sort((a, b) => b.total - a.total);
        const output: z.infer<typeof StockOutput> = {
          items: stored.slice(0, limit).map((report) => ({
            item: report.name,
            unit: report.fluid ? "m³" : "items",
            total: Math.round(report.total),
            containers: Math.round(report.inStorage),
            dimensionalDepot: Math.round(report.inDepot),
          })),
          notShown: Math.max(0, stored.length - limit),
        };
        return ok(output);
      }),
  );
}
