// Lecture des réseaux électriques, commune à #statut et à /energie.
// Le champ PowerProduction de FRM ne compte que la production de base (souvent 0 avec Refined Power) :
// on raisonne comme le panneau électrique du jeu, avec la consommation et la capacité.

import { mw, formatNumber } from "./format.ts";
import type { PowerCircuit } from "./frm.ts";

/** Seuil sous lequel la marge est jugée faible, en part de la capacité. */
const LOW_MARGIN = 0.05;

function totals(circuits: PowerCircuit[]) {
  const sum = (key: "PowerConsumed" | "PowerCapacity" | "PowerMaxConsumed") =>
    circuits.reduce((total, c) => total + c[key], 0);
  return { consumed: sum("PowerConsumed"), maxConsumed: sum("PowerMaxConsumed"), capacity: sum("PowerCapacity") };
}

/** Un réseau sans production, sans consommation et sans batterie (câble isolé…) n'a pas d'intérêt. */
export function isActive(circuit: PowerCircuit): boolean {
  return circuit.PowerCapacity > 0 || circuit.PowerConsumed > 0 || circuit.BatteryCapacity > 0;
}

/** Vrai si un fusible a grillé ou si la capacité ne suffit pas quand tout tourne à fond. */
export function hasProblem(circuits: PowerCircuit[]): boolean {
  const { maxConsumed, capacity } = totals(circuits);
  return circuits.some((c) => c.FuseTriggered) || capacity < maxConsumed;
}

/** Consommation actuelle et max, capacité et marge. */
export function powerLines(circuits: PowerCircuit[]): string[] {
  const { consumed, maxConsumed, capacity } = totals(circuits);
  const margin = capacity - maxConsumed;

  let marginText = `marge : ${mw(margin)}`;
  if (margin < 0) marginText = `🔴 il manque ${mw(-margin)} si tout tourne à fond`;
  else if (capacity > 0 && margin < capacity * LOW_MARGIN) marginText = `⚠️ marge faible : ${mw(margin)}`;

  return [
    `Actuelle : **${mw(consumed)}**`,
    `Max possible : **${mw(maxConsumed)}** (écart : ${mw(maxConsumed - consumed)})`,
    `Capacité : ${mw(capacity)} (${marginText})`,
  ];
}

/** Charge des batteries (moyenne pondérée par la capacité) et tendance, ou undefined s'il n'y en a pas. */
export function batteryText(circuits: PowerCircuit[]): string | undefined {
  const withBatteries = circuits.filter((c) => c.BatteryCapacity > 0);
  if (withBatteries.length === 0) return undefined;

  const capacity = withBatteries.reduce((total, c) => total + c.BatteryCapacity, 0);
  const percent = withBatteries.reduce((total, c) => total + c.BatteryPercent * c.BatteryCapacity, 0) / capacity;
  const differential = withBatteries.reduce((total, c) => total + c.BatteryDifferential, 0);
  const main = withBatteries.reduce((a, b) => (b.BatteryCapacity > a.BatteryCapacity ? b : a));

  let trend = "stables";
  if (differential < -0.01) trend = `se vident (vides dans ${main.BatteryTimeEmpty})`;
  else if (differential > 0.01) trend = `se rechargent (pleines dans ${main.BatteryTimeFull})`;
  return `${formatNumber(percent)} %, ${trend}`;
}
