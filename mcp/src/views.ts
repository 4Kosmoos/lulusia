// Pieces of the tool outputs shared by several tools: their schema (what the tool promises) and how they
// are built from FRM's data (with the computations of @lulusia/lib).

import type { Machine, PowerCircuit } from "@lulusia/lib/frm";
import { minutesUntilEmpty, type ItemReport } from "@lulusia/lib/inventory";
import { countStatuses, groupMachines, machineStatus, recipeRates, type MachineGroup } from "@lulusia/lib/machines";
import { batteryState, isLowMargin, powerTotals } from "@lulusia/lib/power";
import * as z from "zod/v4";
import { round } from "./result.ts";

// --- Power -------------------------------------------------------------------------------------------

export const PowerView = z.object({
  consumedMW: z.number(),
  /** If every machine runs at full speed. */
  maxConsumedMW: z.number(),
  capacityMW: z.number(),
  /** Capacity minus max consumption: negative means not enough power at full load. */
  marginMW: z.number(),
  status: z.enum(["ok", "low margin", "short at full load", "fuse blown"]),
  battery: z
    .object({
      percent: z.number(),
      trend: z.enum(["draining", "charging", "stable"]),
      timeEmpty: z.string(),
      timeFull: z.string(),
    })
    .optional(),
});

type PowerStatus = z.infer<typeof PowerView>["status"];
const SEVERITY: PowerStatus[] = ["ok", "low margin", "short at full load", "fuse blown"];

function circuitStatus(circuit: PowerCircuit): PowerStatus {
  const totals = powerTotals([circuit]);
  if (circuit.FuseTriggered) return "fuse blown";
  if (totals.margin < 0) return "short at full load";
  return isLowMargin(totals) ? "low margin" : "ok";
}

/**
 * Totals of these circuits. The status is the worst one among them: circuits are separate grids, so a
 * surplus on one does not help another.
 */
export function powerView(circuits: PowerCircuit[]): z.infer<typeof PowerView> {
  const totals = powerTotals(circuits);
  const status = circuits
    .map(circuitStatus)
    .reduce<PowerStatus>((worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst), "ok");
  const battery = batteryState(circuits);
  return {
    consumedMW: round(totals.consumed),
    maxConsumedMW: round(totals.maxConsumed),
    capacityMW: round(totals.capacity),
    marginMW: round(totals.margin),
    status,
    ...(battery && { battery: { ...battery, percent: round(battery.percent) } }),
  };
}

// --- Machines ----------------------------------------------------------------------------------------

const StoppedBecause = z.object({
  noPower: z.number(),
  outputFull: z.number(),
  missingInput: z.number(),
  /** Usually a machine caught between two cycles. */
  unknown: z.number(),
});

export const MachineCounts = z.object({
  total: z.number(),
  producing: z.number(),
  paused: z.number(),
  stopped: z.number(),
  stoppedBecause: StoppedBecause,
  averageProductivityPercent: z.number(),
});

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export function machineCounts(machines: Machine[]): z.infer<typeof MachineCounts> {
  const { total, producing, paused, stopped, stoppedBecause } = countStatuses(machines);
  return {
    total,
    producing,
    paused,
    stopped,
    stoppedBecause: {
      noPower: stoppedBecause["no power"],
      outputFull: stoppedBecause["output full"],
      missingInput: stoppedBecause["missing input"],
      unknown: stoppedBecause.unknown,
    },
    averageProductivityPercent: round(average(machines.map((m) => m.Productivity))),
  };
}

const PerMinute = z.object({ item: z.string(), perMin: z.number() });

export const MachineGroupView = z.object({
  building: z.string(),
  recipe: z.string(),
  ...MachineCounts.omit({ total: true }).shape,
  machines: z.number(),
  /** Ingredients that stopped machines of the group lack. */
  missingInputs: z.array(z.string()),
  averageClockSpeedPercent: z.number(),
  /** Current consumption of these machines. */
  powerMW: z.number(),
  /** The recipe for one machine at 100% clock speed. */
  perMachineAt100: z.object({ inputs: z.array(PerMinute), outputs: z.array(PerMinute) }).optional(),
  /** For one item (item_report): what these machines make or use of it, now and at full speed. */
  itemPerMin: z.number().optional(),
  maxItemPerMin: z.number().optional(),
});
export type MachineGroupView = z.infer<typeof MachineGroupView>;

/** A group of machines (same building, same recipe), and optionally its rates for one item. */
export function machineGroupView(group: MachineGroup, item?: { className: string; side: "made" | "used" }): MachineGroupView {
  const { total, ...counts } = machineCounts(group.machines);
  const missing = new Set(
    group.machines.flatMap((m) => {
      const status = machineStatus(m);
      return status.state === "stopped" && status.reason === "missing input" ? status.missing : [];
    }),
  );
  const rates = recipeRates(group.machines);
  const view: MachineGroupView = {
    building: group.building,
    recipe: group.recipe,
    machines: total,
    ...counts,
    missingInputs: [...missing],
    averageClockSpeedPercent: round(average(group.machines.map((m) => m.ManuSpeed))),
    powerMW: round(group.machines.reduce((sum, m) => sum + m.PowerInfo.PowerConsumed, 0)),
    ...(rates && {
      perMachineAt100: {
        inputs: rates.inputs.map((r) => ({ item: r.item, perMin: round(r.perMinute) })),
        outputs: rates.outputs.map((r) => ({ item: r.item, perMin: round(r.perMinute) })),
      },
    }),
  };
  if (item) {
    let current = 0;
    let max = 0;
    for (const machine of group.machines) {
      if (item.side === "made") {
        for (const p of machine.production.filter((p) => p.ClassName === item.className)) {
          current += p.CurrentProd;
          max += p.MaxProd;
        }
      } else {
        for (const i of machine.ingredients.filter((i) => i.ClassName === item.className)) {
          current += i.CurrentConsumed;
          max += i.MaxConsumed;
        }
      }
    }
    view.itemPerMin = round(current);
    view.maxItemPerMin = round(max);
  }
  return view;
}

/** Groups of the machines that make (or use) an item. */
export function groupsFor(machines: Machine[], className: string, side: "made" | "used"): MachineGroupView[] {
  const concerned = machines.filter((m) =>
    side === "made"
      ? m.production.some((p) => p.ClassName === className)
      : m.ingredients.some((i) => i.ClassName === className),
  );
  return groupMachines(concerned).map((group) => machineGroupView(group, { className, side }));
}

// --- Items -------------------------------------------------------------------------------------------

export const Unit = z.enum(["items", "m³"]);

export const BalanceLine = z.object({
  item: z.string(),
  unit: Unit,
  producedPerMin: z.number(),
  maxProducedPerMin: z.number(),
  consumedPerMin: z.number(),
  maxConsumedPerMin: z.number(),
  netPerMin: z.number(),
  inStock: z.number(),
  /** Only when the stock goes down. */
  minutesUntilEmpty: z.number().optional(),
});

/** Production and consumption of an item that machines make or use (report.stat is set). */
export function balanceLine(report: ItemReport): z.infer<typeof BalanceLine> {
  const stat = report.stat;
  const minutes = minutesUntilEmpty(report);
  return {
    item: report.name,
    unit: report.fluid ? "m³" : "items",
    producedPerMin: round(stat?.CurrentProd ?? 0),
    maxProducedPerMin: round(stat?.MaxProd ?? 0),
    consumedPerMin: round(stat?.CurrentConsumed ?? 0),
    maxConsumedPerMin: round(stat?.MaxConsumed ?? 0),
    netPerMin: round(report.balance),
    inStock: Math.round(report.total),
    ...(minutes !== undefined && { minutesUntilEmpty: Math.round(minutes) }),
  };
}
