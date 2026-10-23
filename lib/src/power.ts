// Power circuits: totals, margin and batteries.
// FRM's PowerProduction field only counts base production (often 0 with Refined Power), so we reason
// like the game's power panel, with consumption and capacity.

import type { PowerCircuit } from "./frm.ts";

/** Below this share of the capacity, the margin is considered low. */
export const LOW_MARGIN = 0.05;

export interface PowerTotals {
  /** Current consumption, MW. */
  consumed: number;
  /** Consumption when every machine runs at full speed, MW. */
  maxConsumed: number;
  capacity: number;
  /** Capacity minus max consumption: negative if the circuits cannot run everything at once. */
  margin: number;
}

export function powerTotals(circuits: PowerCircuit[]): PowerTotals {
  const sum = (key: "PowerConsumed" | "PowerCapacity" | "PowerMaxConsumed") =>
    circuits.reduce((total, c) => total + c[key], 0);
  const consumed = sum("PowerConsumed");
  const maxConsumed = sum("PowerMaxConsumed");
  const capacity = sum("PowerCapacity");
  return { consumed, maxConsumed, capacity, margin: capacity - maxConsumed };
}

/** True if the margin is positive but less than LOW_MARGIN of the capacity. */
export function isLowMargin({ capacity, margin }: PowerTotals): boolean {
  return margin >= 0 && capacity > 0 && margin < capacity * LOW_MARGIN;
}

/** A circuit with no production, no consumption and no battery (a lone cable…) is not worth showing. */
export function isActive(circuit: PowerCircuit): boolean {
  return circuit.PowerCapacity > 0 || circuit.PowerConsumed > 0 || circuit.BatteryCapacity > 0;
}

/** True if a fuse has blown or if the capacity is not enough when everything runs at full speed. */
export function hasProblem(circuits: PowerCircuit[]): boolean {
  return circuits.some((c) => c.FuseTriggered) || powerTotals(circuits).margin < 0;
}

export interface BatteryState {
  /** Charge of all batteries, weighted by their capacity (0 to 100). */
  percent: number;
  trend: "draining" | "charging" | "stable";
  /** Time before empty and before full, as given by the game for the circuit with the most storage ("00:41:10"). */
  timeEmpty: string;
  timeFull: string;
}

/** State of the batteries of these circuits, or undefined if there are none. */
export function batteryState(circuits: PowerCircuit[]): BatteryState | undefined {
  const withBatteries = circuits.filter((c) => c.BatteryCapacity > 0);
  if (withBatteries.length === 0) return undefined;

  const capacity = withBatteries.reduce((total, c) => total + c.BatteryCapacity, 0);
  const percent = withBatteries.reduce((total, c) => total + c.BatteryPercent * c.BatteryCapacity, 0) / capacity;
  const differential = withBatteries.reduce((total, c) => total + c.BatteryDifferential, 0);
  const main = withBatteries.reduce((a, b) => (b.BatteryCapacity > a.BatteryCapacity ? b : a));

  let trend: BatteryState["trend"] = "stable";
  if (differential < -0.01) trend = "draining";
  else if (differential > 0.01) trend = "charging";
  return { percent, trend, timeEmpty: main.BatteryTimeEmpty, timeFull: main.BatteryTimeFull };
}
