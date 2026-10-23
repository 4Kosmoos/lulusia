// factory_overview: the state of the whole factory in one call.

import { BALANCED, reportFor } from "@lulusia/lib/inventory";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, ok, withFrm } from "../result.ts";
import { BalanceLine, MachineCounts, PowerView, balanceLine, machineCounts, powerView } from "../views.ts";

const DEFICITS_SHOWN = 5;

const Overview = z.object({
  session: z.object({
    name: z.string(),
    playTime: z.string(),
    day: z.number(),
    paused: z.boolean(),
  }),
  playersOnline: z.array(z.string()),
  power: PowerView,
  machines: MachineCounts,
  /** Items consumed faster than produced, worst first. */
  biggestDeficits: z.array(BalanceLine),
});

export function registerOverview(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "factory_overview",
    {
      title: "Factory overview",
      description:
        "State of the whole factory right now: session, players online, power (consumption, capacity, margin, " +
        "batteries), production machines (producing, paused, stopped and why) and the biggest deficits. " +
        "Start here for any general question about the factory, then use the other tools for details.",
      outputSchema: Overview,
      annotations: READ_ONLY,
    },
    () =>
      withFrm(async () => {
        const [session, players, power, inventory, machines] = await Promise.all([
          data.session(),
          data.players(),
          data.power(),
          data.inventory(),
          data.machines(),
        ]);
        const deficits = inventory.items
          .map((item) => reportFor(inventory, item))
          .filter((report) => report.stat && report.balance < -BALANCED)
          .sort((a, b) => a.balance - b.balance)
          .slice(0, DEFICITS_SHOWN);
        const output: z.infer<typeof Overview> = {
          session: {
            name: session.SessionName,
            playTime: session.TotalPlayDurationText,
            day: session.PassedDays,
            paused: session.IsPaused,
          },
          playersOnline: players.filter((p) => p.Online).map((p) => p.Name),
          power: powerView(power),
          machines: machineCounts(machines),
          biggestDeficits: deficits.map(balanceLine),
        };
        return ok(output);
      }),
  );
}
