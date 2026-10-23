// power: the power circuits one by one, and in total.

import { isActive } from "@lulusia/lib/power";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, ok, withFrm } from "../result.ts";
import { PowerView, powerView } from "../views.ts";

const PowerOutput = z.object({
  /** All circuits together; the status is the worst circuit's. */
  total: PowerView,
  /** Circuits with something on them (capacity, consumption or batteries), largest first. */
  circuits: z.array(z.object({ id: z.number(), ...PowerView.shape })),
});

export function registerPower(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "power",
    {
      title: "Power circuits",
      description:
        "Power circuits: consumption now and at full load (every machine at full speed), capacity, margin, " +
        "blown fuses and batteries, for each circuit and in total. Capacity and consumption are what count: " +
        "FRM's production figure is wrong with the Refined Power mod.",
      outputSchema: PowerOutput,
      annotations: READ_ONLY,
    },
    () =>
      withFrm(async () => {
        const circuits = await data.power();
        // A circuit with machines but no generator is worth showing: its machines cannot run.
        const shown = circuits
          .filter((c) => isActive(c) || c.PowerMaxConsumed > 0)
          .sort((a, b) => b.PowerCapacity - a.PowerCapacity);
        const output: z.infer<typeof PowerOutput> = {
          total: powerView(circuits),
          circuits: shown.map((circuit) => ({ id: circuit.CircuitGroupID, ...powerView([circuit]) })),
        };
        return ok(output);
      }),
  );
}
