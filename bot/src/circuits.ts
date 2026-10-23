// Text of the power circuits, shared by #statut and /power (the computations are in @lulusia/lib/power).

import { mw, percent } from "@lulusia/lib/format";
import type { PowerCircuit } from "@lulusia/lib/frm";
import { batteryState, isLowMargin, powerTotals } from "@lulusia/lib/power";

/** Current and max consumption, capacity and margin. */
export function powerLines(circuits: PowerCircuit[]): string[] {
  const totals = powerTotals(circuits);
  const { consumed, maxConsumed, capacity, margin } = totals;

  let marginText = `margin: ${mw(margin)}`;
  if (margin < 0) marginText = `🔴 ${mw(-margin)} short at full load`;
  else if (isLowMargin(totals)) marginText = `⚠️ low margin: ${mw(margin)}`;

  return [
    `Current: **${mw(consumed)}**`,
    `Max: **${mw(maxConsumed)}** (+${mw(maxConsumed - consumed)} at full load)`,
    `Capacity: ${mw(capacity)} (${marginText})`,
  ];
}

/** Battery charge and trend, or undefined if there are none. */
export function batteryText(circuits: PowerCircuit[]): string | undefined {
  const battery = batteryState(circuits);
  if (!battery) return undefined;
  const trend = {
    draining: `draining (empty in ${battery.timeEmpty})`,
    charging: `charging (full in ${battery.timeFull})`,
    stable: "stable",
  }[battery.trend];
  return `${percent(battery.percent)}, ${trend}`;
}
