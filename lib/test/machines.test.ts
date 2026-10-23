import assert from "node:assert/strict";
import { test } from "node:test";
import type { Machine, MachineSlot } from "../src/frm.ts";
import { countStatuses, groupMachines, machineStatus, recipeRates } from "../src/machines.ts";

const slot = (Name: string, ClassName: string, Amount: number, MaxAmount: number): MachineSlot => ({
  Name,
  ClassName,
  Amount,
  MaxAmount,
});

/** An assembler making Tin Plate (12 per cycle) from Tin Ingot (9) and Iron Plate (6), like in SF+. */
function tinPlate(values: Partial<Machine> = {}): Machine {
  return {
    ID: "Build_AssemblerMk1_C_1",
    Name: "Assembler",
    Recipe: "Tin Plate",
    production: [{ Name: "Tin Plate", ClassName: "Desc_TinPlates_C", Amount: 12, CurrentProd: 40, MaxProd: 40 }],
    ingredients: [
      { Name: "Tin Ingot", ClassName: "Desc_TinIngot_C", Amount: 9, CurrentConsumed: 30, MaxConsumed: 30 },
      { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 6, CurrentConsumed: 20, MaxConsumed: 20 },
    ],
    InputInventory: [slot("Tin Ingot", "Desc_TinIngot_C", 50, 200), slot("Iron Plate", "Desc_IronPlate_C", 60, 200)],
    OutputInventory: [slot("Tin Plate", "Desc_TinPlates_C", 12, 200)],
    Productivity: 100,
    ManuSpeed: 100,
    Somersloops: 0,
    PowerShards: 0,
    IsConfigured: true,
    IsProducing: true,
    IsPaused: false,
    PowerInfo: { CircuitGroupID: 2, CircuitID: 15, FuseTriggered: false, PowerConsumed: 15, MaxPowerConsumed: 15 },
    location: { x: 0, y: 0, z: 0 },
    ...values,
  };
}

const standby = { CircuitGroupID: 2, CircuitID: 15, FuseTriggered: false, PowerConsumed: 0.1, MaxPowerConsumed: 15 };

test("producing and paused machines", () => {
  assert.deepEqual(machineStatus(tinPlate()), { state: "producing" });
  assert.deepEqual(machineStatus(tinPlate({ IsPaused: true, IsProducing: false })), { state: "paused" });
});

test("stopped: output full, also just under the limit (snapshot taken between two cycles)", () => {
  const full = tinPlate({ IsProducing: false, PowerInfo: standby, OutputInventory: [slot("Tin Plate", "Desc_TinPlates_C", 200, 200)] });
  assert.deepEqual(machineStatus(full), { state: "stopped", reason: "output full", missing: [] });
  const almost = tinPlate({ IsProducing: false, PowerInfo: standby, OutputInventory: [slot("Tin Plate", "Desc_TinPlates_C", 189, 200)] });
  assert.deepEqual(machineStatus(almost), { state: "stopped", reason: "output full", missing: [] });
});

test("stopped: missing input, with the ingredients short of one cycle", () => {
  const starved = tinPlate({
    IsProducing: false,
    PowerInfo: standby,
    InputInventory: [slot("Tin Ingot", "Desc_TinIngot_C", 8, 200), slot("Iron Plate", "Desc_IronPlate_C", 200, 200)],
  });
  assert.deepEqual(machineStatus(starved), { state: "stopped", reason: "missing input", missing: ["Tin Ingot"] });
  const empty = tinPlate({ IsProducing: false, PowerInfo: standby, InputInventory: [], OutputInventory: [] });
  assert.deepEqual(machineStatus(empty), { state: "stopped", reason: "missing input", missing: ["Tin Ingot", "Iron Plate"] });
});

test("stopped: no power wins over the other reasons", () => {
  const unpowered = tinPlate({ IsProducing: false, InputInventory: [], PowerInfo: { ...standby, PowerConsumed: 0 } });
  assert.deepEqual(machineStatus(unpowered), { state: "stopped", reason: "no power", missing: ["Tin Ingot", "Iron Plate"] });
  const fuse = tinPlate({ IsProducing: false, PowerInfo: { ...standby, FuseTriggered: true } });
  assert.deepEqual(machineStatus(fuse), { state: "stopped", reason: "no power", missing: [] });
});

test("stopped with everything it needs: unknown", () => {
  assert.deepEqual(machineStatus(tinPlate({ IsProducing: false, PowerInfo: standby })), {
    state: "stopped",
    reason: "unknown",
    missing: [],
  });
});

test("counts by state and by reason", () => {
  const counts = countStatuses([
    tinPlate(),
    tinPlate(),
    tinPlate({ IsPaused: true, IsProducing: false }),
    tinPlate({ IsProducing: false, PowerInfo: standby, InputInventory: [] }),
  ]);
  assert.deepEqual(counts, {
    total: 4,
    producing: 2,
    paused: 1,
    stopped: 1,
    stoppedBecause: { "no power": 0, "output full": 0, "missing input": 1, unknown: 0 },
  });
});

test("groups by building and recipe, largest first", () => {
  const rod = tinPlate({ Name: "Constructor", Recipe: "Iron Rod" });
  const groups = groupMachines([rod, tinPlate(), tinPlate()]);
  assert.deepEqual(
    groups.map((g) => [g.building, g.recipe, g.machines.length]),
    [
      ["Assembler", "Tin Plate", 2],
      ["Constructor", "Iron Rod", 1],
    ],
  );
});

test("recipe rates at 100%, from a machine without somersloop", () => {
  const underclocked = tinPlate({
    ManuSpeed: 50,
    production: [{ Name: "Tin Plate", ClassName: "Desc_TinPlates_C", Amount: 12, CurrentProd: 20, MaxProd: 20 }],
    ingredients: [
      { Name: "Tin Ingot", ClassName: "Desc_TinIngot_C", Amount: 9, CurrentConsumed: 15, MaxConsumed: 15 },
      { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 6, CurrentConsumed: 10, MaxConsumed: 10 },
    ],
  });
  const boosted = tinPlate({ Somersloops: 1, production: [{ ...tinPlate().production[0], MaxProd: 80 }] });
  const rates = recipeRates([boosted, underclocked]);
  assert.deepEqual(rates, {
    inputs: [
      { item: "Tin Ingot", className: "Desc_TinIngot_C", perMinute: 30 },
      { item: "Iron Plate", className: "Desc_IronPlate_C", perMinute: 20 },
    ],
    outputs: [{ item: "Tin Plate", className: "Desc_TinPlates_C", perMinute: 40 }],
  });
  assert.equal(recipeRates([boosted]), undefined);
});
