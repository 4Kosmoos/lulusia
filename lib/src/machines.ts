// Production machines: why a machine stands still, groups by building and recipe, and recipe rates.

import type { Machine } from "./frm.ts";

/**
 * Share of an output slot above which the output counts as full: the belt or the storage after the
 * machine is backed up. Below the exact limit, because FRM's snapshot often catches the machine
 * just before the next cycle would overflow.
 */
export const OUTPUT_FULL = 0.9;

export type StopReason = "no power" | "output full" | "missing input" | "unknown";

export type MachineStatus =
  | { state: "producing" | "paused" }
  | {
      state: "stopped";
      reason: StopReason;
      /** Ingredients with less than one cycle's worth in the machine. */
      missing: string[];
    };

/** Ingredients the machine does not have enough of for one cycle (a missing slot counts as empty). */
function missingInputs(machine: Machine): string[] {
  return machine.ingredients
    .filter((ingredient) => {
      const inside = machine.InputInventory.filter((slot) => slot.ClassName === ingredient.ClassName).reduce(
        (sum, slot) => sum + slot.Amount,
        0,
      );
      return inside < ingredient.Amount;
    })
    .map((ingredient) => ingredient.Name);
}

function outputFull(machine: Machine): boolean {
  return machine.OutputInventory.some((slot) => {
    if (slot.MaxAmount <= 0) return false;
    const perCycle = machine.production.find((p) => p.ClassName === slot.ClassName)?.Amount ?? 0;
    return slot.Amount >= slot.MaxAmount * OUTPUT_FULL || slot.Amount + perCycle > slot.MaxAmount;
  });
}

/**
 * State of a machine in FRM's snapshot. A stopped machine gets the most likely reason, checked in this
 * order: no power (blown fuse, or not even the standby draw of a powered machine), output full,
 * missing input. "unknown" is usually a machine caught between two cycles.
 */
export function machineStatus(machine: Machine): MachineStatus {
  if (machine.IsPaused) return { state: "paused" };
  if (machine.IsProducing) return { state: "producing" };
  const missing = missingInputs(machine);
  let reason: StopReason = "unknown";
  if (machine.PowerInfo.FuseTriggered || machine.PowerInfo.PowerConsumed === 0) reason = "no power";
  else if (outputFull(machine)) reason = "output full";
  else if (missing.length > 0) reason = "missing input";
  return { state: "stopped", reason, missing };
}

export interface StatusCounts {
  total: number;
  producing: number;
  paused: number;
  stopped: number;
  /** Stopped machines by reason. */
  stoppedBecause: Record<StopReason, number>;
}

export function countStatuses(machines: Machine[]): StatusCounts {
  const counts: StatusCounts = {
    total: machines.length,
    producing: 0,
    paused: 0,
    stopped: 0,
    stoppedBecause: { "no power": 0, "output full": 0, "missing input": 0, unknown: 0 },
  };
  for (const machine of machines) {
    const status = machineStatus(machine);
    counts[status.state] += 1;
    if (status.state === "stopped") counts.stoppedBecause[status.reason] += 1;
  }
  return counts;
}

export interface MachineGroup {
  /** Machine type ("Constructor"). */
  building: string;
  recipe: string;
  machines: Machine[];
}

/** Machines grouped by building and recipe, largest groups first. */
export function groupMachines(machines: Machine[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();
  for (const machine of machines) {
    const key = JSON.stringify([machine.Name, machine.Recipe]);
    let group = groups.get(key);
    if (!group) {
      group = { building: machine.Name, recipe: machine.Recipe, machines: [] };
      groups.set(key, group);
    }
    group.machines.push(machine);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.machines.length - a.machines.length ||
      a.building.localeCompare(b.building, "en") ||
      a.recipe.localeCompare(b.recipe, "en"),
  );
}

export interface Rate {
  item: string;
  className: string;
  perMinute: number;
}

/**
 * Inputs and outputs of a recipe for one machine at 100% clock speed, taken from a machine of the group
 * without somersloop (which multiplies the output). Undefined if there is none.
 */
export function recipeRates(machines: Machine[]): { inputs: Rate[]; outputs: Rate[] } | undefined {
  const reference = machines.find((m) => m.Somersloops === 0 && m.ManuSpeed > 0 && m.production.length > 0);
  if (!reference) return undefined;
  const scale = 100 / reference.ManuSpeed;
  return {
    inputs: reference.ingredients.map((i) => ({ item: i.Name, className: i.ClassName, perMinute: i.MaxConsumed * scale })),
    outputs: reference.production.map((p) => ({ item: p.Name, className: p.ClassName, perMinute: p.MaxProd * scale })),
  };
}
