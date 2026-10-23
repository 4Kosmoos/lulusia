// production_balance: items whose production and consumption do not match.

import { BALANCED, reportFor } from "@lulusia/lib/inventory";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, ok, withFrm } from "../result.ts";
import { BalanceLine, balanceLine } from "../views.ts";

const BalanceOutput = z.object({
  items: z.array(BalanceLine),
  /** Counts over all the items machines make or use, whatever the filter. */
  deficits: z.number(),
  surpluses: z.number(),
  balanced: z.number(),
  /** Items left out by the limit. */
  notShown: z.number(),
});

export function registerProductionBalance(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "production_balance",
    {
      title: "Production balance",
      description:
        "Items whose production and consumption do not match right now: deficits (consumed faster than produced, " +
        "worst first, with the stock left and the time before it runs out) or surpluses (largest first). " +
        "Current rates drop when storage or belts are full, so the rates at full speed are given too.",
      inputSchema: z.object({
        show: z.enum(["deficits", "surpluses", "all"]).default("deficits"),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: BalanceOutput,
      annotations: READ_ONLY,
    },
    ({ show, limit }) =>
      withFrm(async () => {
        const inventory = await data.inventory();
        const active = inventory.items.map((item) => reportFor(inventory, item)).filter((report) => report.stat);
        const deficits = active.filter((r) => r.balance < -BALANCED).sort((a, b) => a.balance - b.balance);
        const surpluses = active.filter((r) => r.balance > BALANCED).sort((a, b) => b.balance - a.balance);
        const shown = { deficits, surpluses, all: [...deficits, ...surpluses] }[show];
        const output: z.infer<typeof BalanceOutput> = {
          items: shown.slice(0, limit).map(balanceLine),
          deficits: deficits.length,
          surpluses: surpluses.length,
          balanced: active.length - deficits.length - surpluses.length,
          notShown: Math.max(0, shown.length - limit),
        };
        return ok(output);
      }),
  );
}
