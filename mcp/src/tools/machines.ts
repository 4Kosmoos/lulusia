// machines: production machines grouped by building and recipe, with why they stand still.

import type { Machine } from "@lulusia/lib/frm";
import { groupMachines, machineStatus } from "@lulusia/lib/machines";
import { normalize, resolve } from "@lulusia/lib/search";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { FactoryData } from "../data.ts";
import { READ_ONLY, fail, ok, withFrm } from "../result.ts";
import { MachineCounts, MachineGroupView, machineCounts, machineGroupView } from "../views.ts";

const MachinesOutput = z.object({
  /** Counts for the machines that match the filters. */
  counts: MachineCounts,
  groups: z.array(MachineGroupView),
  /** Groups left out by the limit. */
  notShown: z.number(),
});

/** Every item the machines make or use, by class name, for the item filter. */
function itemsOf(machines: Machine[]): { className: string; name: string }[] {
  const names = new Map<string, string>();
  for (const machine of machines) {
    for (const { ClassName, Name } of [...machine.production, ...machine.ingredients]) names.set(ClassName, Name);
  }
  return [...names].map(([className, name]) => ({ className, name }));
}

export function registerMachines(server: McpServer, data: FactoryData): void {
  server.registerTool(
    "machines",
    {
      title: "Production machines",
      description:
        "Production machines (not extractors nor generators) grouped by building and recipe: how many, how many " +
        "produce, are paused or stopped and why (no power, output full = the belt or storage after it is backed " +
        "up, missing input), productivity, clock speed, power, and the recipe's inputs and outputs per machine at " +
        "100%. Filter by state, by an item the machines make or use, or by building. Use it to find bottlenecks " +
        "and to read the recipes the factory actually uses (the mod pack changes many of them).",
      inputSchema: z.object({
        state: z.enum(["all", "producing", "stopped", "paused"]).default("all"),
        item: z.string().optional().describe("Only machines that make or use this item (English name, or part of it)"),
        building: z.string().optional().describe('Only this type of machine, e.g. "Constructor", "Smelter"'),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      outputSchema: MachinesOutput,
      annotations: READ_ONLY,
    },
    ({ state, item, building, limit }) =>
      withFrm(async () => {
        let machines = await data.machines();
        if (item) {
          const { found, ambiguous } = resolve(itemsOf(machines), item, (i) => i.className, (i) => i.name);
          if (!found) {
            return fail(
              ambiguous.length > 0
                ? `Several items match "${item}": ${ambiguous.join(", ")}. Call again with one of these names.`
                : `No machine makes or uses an item named "${item}".`,
            );
          }
          machines = machines.filter((m) =>
            [...m.production, ...m.ingredients].some((entry) => entry.ClassName === found.className),
          );
        }
        if (building) {
          const query = normalize(building);
          machines = machines.filter((m) => normalize(m.Name).includes(query));
        }
        if (state !== "all") machines = machines.filter((m) => machineStatus(m).state === state);
        const groups = groupMachines(machines);
        const output: z.infer<typeof MachinesOutput> = {
          counts: machineCounts(machines),
          groups: groups.slice(0, limit).map((group) => machineGroupView(group)),
          notShown: Math.max(0, groups.length - limit),
        };
        return ok(output);
      }),
  );
}
