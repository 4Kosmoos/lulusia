import assert from "node:assert/strict";
import { test } from "node:test";
import type { PowerCircuit } from "../src/frm.ts";
import { batteryState, hasProblem, isActive, isLowMargin, powerTotals } from "../src/power.ts";

function circuit(values: Partial<PowerCircuit>): PowerCircuit {
  return {
    CircuitGroupID: 1,
    PowerProduction: 0,
    PowerConsumed: 0,
    PowerCapacity: 0,
    PowerMaxConsumed: 0,
    BatteryDifferential: 0,
    BatteryPercent: 0,
    BatteryCapacity: 0,
    BatteryTimeEmpty: "00:00:00",
    BatteryTimeFull: "00:00:00",
    FuseTriggered: false,
    ...values,
  };
}

// Like the factory in October 2026: the main circuit would be short at full load.
const main = circuit({ CircuitGroupID: 2, PowerConsumed: 3846.7, PowerCapacity: 6750, PowerMaxConsumed: 7064.5 });
const small = circuit({ CircuitGroupID: 1, PowerConsumed: 79, PowerCapacity: 1350, PowerMaxConsumed: 217.6 });
const cable = circuit({ CircuitGroupID: 0, PowerMaxConsumed: 12 });

test("totals and margin of several circuits", () => {
  const totals = powerTotals([main, small]);
  assert.equal(totals.consumed, 3846.7 + 79);
  assert.equal(totals.capacity, 8100);
  assert.equal(totals.maxConsumed, 7064.5 + 217.6);
  assert.equal(totals.margin, 8100 - (7064.5 + 217.6));
});

test("a circuit is a problem if it is short at full load or if a fuse has blown", () => {
  assert.equal(hasProblem([main]), true);
  assert.equal(hasProblem([small]), false);
  assert.equal(hasProblem([circuit({ PowerCapacity: 100, PowerMaxConsumed: 10, FuseTriggered: true })]), true);
});

test("low margin: positive but under 5% of the capacity", () => {
  assert.equal(isLowMargin(powerTotals([circuit({ PowerCapacity: 1000, PowerMaxConsumed: 960 })])), true);
  assert.equal(isLowMargin(powerTotals([circuit({ PowerCapacity: 1000, PowerMaxConsumed: 900 })])), false);
  assert.equal(isLowMargin(powerTotals([main])), false, "short, not low");
});

test("a lone cable is not an active circuit", () => {
  assert.equal(isActive(cable), false);
  assert.equal(isActive(main), true);
  assert.equal(isActive(circuit({ BatteryCapacity: 100 })), true);
});

test("batteries: charge weighted by capacity, trend of the whole", () => {
  assert.equal(batteryState([main]), undefined);
  const state = batteryState([
    circuit({ BatteryCapacity: 300, BatteryPercent: 80, BatteryDifferential: -5, BatteryTimeEmpty: "01:20:00" }),
    circuit({ BatteryCapacity: 100, BatteryPercent: 40, BatteryDifferential: 1, BatteryTimeEmpty: "00:10:00" }),
  ]);
  assert.deepEqual(state, { percent: 70, trend: "draining", timeEmpty: "01:20:00", timeFull: "00:00:00" });
  assert.equal(batteryState([circuit({ BatteryCapacity: 100, BatteryDifferential: 0.005 })])?.trend, "stable");
  assert.equal(batteryState([circuit({ BatteryCapacity: 100, BatteryDifferential: 2 })])?.trend, "charging");
});
