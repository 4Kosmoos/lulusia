// Power circuits, shared by #statut and /power.
// FRM's PowerProduction field only counts base production (often 0 with Refined Power), so we reason
// like the game's power panel, with consumption and capacity.

import { mw, percent } from "./format.ts";
import type { PowerCircuit } from "./frm.ts";

/** Below this share of the capacity, the margin is considered low. */
const LOW_MARGIN = 0.05;

function totals(circuits: PowerCircuit[]) {
  const sum = (key: "PowerConsumed" | "PowerCapacity" | "PowerMaxConsumed") =>
    circuits.reduce((total, c) => total + c[key], 0);
  return { consumed: sum("PowerConsumed"), maxConsumed: sum("PowerMaxConsumed"), capacity: sum("PowerCapacity") };
}

/** A circuit with no production, no consumption and no battery (a lone cable…) is not worth showing. */
export function isActive(circuit: PowerCircuit): boolean {
  return circuit.PowerCapacity > 0 || circuit.PowerConsumed > 0 || circuit.BatteryCapacity > 0;
}

/** True if a fuse has blown or if the capacity is not enough when everything runs at full speed. */
export function hasProblem(circuits: PowerCircuit[]): boolean {
  const { maxConsumed, capacity } = totals(circuits);
  return circuits.some((c) => c.FuseTriggered) || capacity < maxConsumed;
}

/** Current and max consumption, capacity and margin. */
export function powerLines(circuits: PowerCircuit[]): string[] {
  const { consumed, maxConsumed, capacity } = totals(circuits);
  const margin = capacity - maxConsumed;

  let marginText = `margin: ${mw(margin)}`;
  if (margin < 0) marginText = `🔴 ${mw(-margin)} short at full load`;
  else if (capacity > 0 && margin < capacity * LOW_MARGIN) marginText = `⚠️ low margin: ${mw(margin)}`;

  return [
    `Current: **${mw(consumed)}**`,
    `Max: **${mw(maxConsumed)}** (+${mw(maxConsumed - consumed)} at full load)`,
    `Capacity: ${mw(capacity)} (${marginText})`,
  ];
}

/** Battery charge (weighted by capacity) and trend, or undefined if there are none. */
export function batteryText(circuits: PowerCircuit[]): string | undefined {
  const withBatteries = circuits.filter((c) => c.BatteryCapacity > 0);
  if (withBatteries.length === 0) return undefined;

  const capacity = withBatteries.reduce((total, c) => total + c.BatteryCapacity, 0);
  const charge = withBatteries.reduce((total, c) => total + c.BatteryPercent * c.BatteryCapacity, 0) / capacity;
  const differential = withBatteries.reduce((total, c) => total + c.BatteryDifferential, 0);
  const main = withBatteries.reduce((a, b) => (b.BatteryCapacity > a.BatteryCapacity ? b : a));

  let trend = "stable";
  if (differential < -0.01) trend = `draining (empty in ${main.BatteryTimeEmpty})`;
  else if (differential > 0.01) trend = `charging (full in ${main.BatteryTimeFull})`;
  return `${percent(charge)}, ${trend}`;
}
