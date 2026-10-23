import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemAmount, ProductionStat } from "../src/frm.ts";
import { findItem, loadInventory, minutesUntilEmpty, reportFor, type Inventory } from "../src/inventory.ts";

const amount = (Name: string, ClassName: string, Amount: number): ItemAmount => ({ Name, ClassName, Amount });
const stat = (
  Name: string,
  ClassName: string,
  [CurrentProd, MaxProd, CurrentConsumed, MaxConsumed]: number[],
  Type: ProductionStat["Type"] = "Solid",
): ProductionStat => ({ Name, ClassName, CurrentProd, MaxProd, CurrentConsumed, MaxConsumed, Type });

const fakeFrm = {
  storageTotals: async () => [
    amount("Iron Plate", "Desc_IronPlate_C", 850),
    amount("Iron Ingot", "Desc_IronIngot_C", 5000),
    amount("Tin Plate", "Desc_TinPlates_C", 300),
  ],
  dimensionalDepot: async () => [amount("Iron Plate", "Desc_IronPlate_C", 200)],
  productionStats: async () => [
    stat("Iron Plate", "Desc_IronPlate_C", [40, 60, 30, 30]),
    stat("Iron Ingot", "Desc_IronIngot_C", [30, 30, 42, 45]),
    stat("Water", "Desc_Water_C", [120, 120, 120, 120], "Liquid"),
    stat("Copper Ore", "Desc_OreCopper_C", [0, 0, 0, 0]),
  ],
};

const load = (): Promise<Inventory> => loadInventory(fakeFrm);

test("the inventory lists each item once, sorted by name", async () => {
  const { items } = await load();
  assert.deepEqual(
    items.map((i) => i.name),
    ["Copper Ore", "Iron Ingot", "Iron Plate", "Tin Plate", "Water"],
  );
});

test("report: containers and dimensional depot add up, with the balance", async () => {
  const inventory = await load();
  const report = reportFor(inventory, { className: "Desc_IronPlate_C", name: "Iron Plate" });
  assert.equal(report.inStorage, 850);
  assert.equal(report.inDepot, 200);
  assert.equal(report.total, 1050);
  assert.equal(report.balance, 10);
  assert.equal(report.fluid, false);
  assert.equal(minutesUntilEmpty(report), undefined);
});

test("report: time before the stock runs out when consumption wins", async () => {
  const report = reportFor(await load(), { className: "Desc_IronIngot_C", name: "Iron Ingot" });
  assert.equal(report.balance, -12);
  assert.equal(minutesUntilEmpty(report), 5000 / 12);
});

test("report: fluids are in m³", async () => {
  const report = reportFor(await load(), { className: "Desc_Water_C", name: "Water" });
  assert.equal(report.fluid, true);
  assert.equal(report.unit, " m³");
});

test("report: an item no machine uses has no rates and a zero balance", async () => {
  const inventory = await load();
  const idle = reportFor(inventory, { className: "Desc_OreCopper_C", name: "Copper Ore" });
  assert.equal(idle.stat, undefined);
  assert.equal(idle.balance, 0);
  const stored = reportFor(inventory, { className: "Desc_TinPlates_C", name: "Tin Plate" });
  assert.equal(stored.total, 300);
  assert.equal(stored.stat, undefined);
});

test("findItem: by identifier, exact name or the only partial match", async () => {
  const { items } = await load();
  assert.equal(findItem(items, "Desc_IronPlate_C").found?.name, "Iron Plate");
  assert.equal(findItem(items, "water").found?.name, "Water");
  assert.equal(findItem(items, "tin").found?.name, "Tin Plate");
  assert.deepEqual(findItem(items, "iron"), { ambiguous: ["Iron Ingot", "Iron Plate"] });
});
