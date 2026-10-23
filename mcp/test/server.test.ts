// The MCP server end to end: a real MCP client, the server in the same process (2026-07-28 protocol),
// and a fake FRM serving an extract of the real factory.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createFrmReader } from "@lulusia/lib/frm";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFactoryData } from "../src/data.ts";
import { createServer } from "../src/server.ts";
import { startFakeFrm, type FakeFrm } from "./fake-frm.ts";

let frm: FakeFrm;
let handler: ReturnType<typeof createMcpHandler>;
let client: Client;

before(async () => {
  frm = await startFakeFrm();
  // No cache (0 ms): every call reads the fake FRM, so that a test can switch it off.
  const data = createFactoryData(createFrmReader({ url: frm.url }), 0);
  handler = createMcpHandler(() => createServer(data));
  client = new Client({ name: "lulusia-tests", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
});

after(async () => {
  await client.close();
  await handler.close();
  await frm.close();
});

beforeEach(() => {
  frm.down = false;
});

/** Text of a tool result: what the model reads. */
function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [block] = result.content;
  assert.equal(block?.type, "text");
  return block?.type === "text" ? block.text : "";
}

/**
 * Calls a tool that must succeed, checks that the text the model reads holds the same data as the
 * structured output, and returns that output. The SDK has already checked it against the output schema.
 */
async function output(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(JSON.parse(textOf(result)), result.structuredContent);
  return result.structuredContent;
}

/** Calls a tool that must fail, and returns the message the model reads. */
async function failure(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  return textOf(result);
}

test("six read-only tools with an output schema, two prompts, and instructions for the model", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "factory_overview",
    "item_report",
    "machines",
    "power",
    "production_balance",
    "stock",
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    assert.ok(tool.outputSchema, tool.name);
    assert.ok(tool.description && tool.description.length > 80, tool.name);
  }
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ["factory_checkup", "plan_production"]);
  assert.match(client.getInstructions() ?? "", /Read-only/);
});

test("factory_overview: session, players, power, machines and deficits", async () => {
  const overview = await output("factory_overview");
  assert.deepEqual(overview.session, { name: "Test session", playTime: "600:11:26", day: 602, paused: false });
  assert.deepEqual(overview.playersOnline, ["Player 1"]);
  // Enough capacity in total, but the main circuit (and one without generator) would be short at full load.
  assert.deepEqual(overview.power, {
    consumedMW: 3925.7,
    maxConsumedMW: 7294.1,
    capacityMW: 8100,
    marginMW: 805.9,
    status: "short at full load",
  });
  assert.deepEqual(overview.machines, {
    total: 36,
    producing: 16,
    paused: 1,
    stopped: 19,
    stoppedBecause: { noPower: 3, outputFull: 11, missingInput: 4, unknown: 1 },
    averageProductivityPercent: 56.3,
  });
  assert.deepEqual(
    overview.biggestDeficits.map((d: { item: string }) => d.item),
    ["Crushed Siterite", "Carbon Powder", "Copper Ingot", "Iron Ingot", "Caterium Ingot"],
  );
  assert.equal(overview.biggestDeficits[0].netPerMin, -311.3);
  assert.equal(overview.biggestDeficits[0].minutesUntilEmpty, 17);
});

test("item_report: stock, rates, and the recipes that make and use the item", async () => {
  const report = await output("item_report", { item: "iron plate" });
  assert.equal(report.item, "Iron Plate");
  assert.deepEqual(report.stock, { containers: 14403, dimensionalDepot: 800, total: 15203 });
  assert.deepEqual(report.rates, {
    producedPerMin: 74.6,
    maxProducedPerMin: 120,
    consumedPerMin: 54.3,
    maxConsumedPerMin: 104,
    netPerMin: 20.3,
  });
  assert.equal(report.minutesUntilEmpty, undefined);

  assert.equal(report.madeBy.length, 1);
  const constructors = report.madeBy[0];
  assert.equal(constructors.recipe, "Iron Plate");
  assert.equal(constructors.machines, 6);
  assert.equal(constructors.producing, 3);
  assert.deepEqual(constructors.stoppedBecause, { noPower: 0, outputFull: 2, missingInput: 1, unknown: 0 });
  assert.deepEqual(constructors.missingInputs, ["Iron Ingot"]);
  assert.equal(constructors.itemPerMin, 74.5);
  assert.equal(constructors.maxItemPerMin, 120);
  assert.deepEqual(constructors.perMachineAt100, {
    inputs: [{ item: "Iron Ingot", perMin: 30 }],
    outputs: [{ item: "Iron Plate", perMin: 20 }],
  });

  assert.deepEqual(
    report.usedBy.map((g: { recipe: string; itemPerMin: number }) => [g.recipe, g.itemPerMin]),
    [
      ["Tin Plate", 13.6],
      ["Alternate: Compacted Iron Plate", 20],
    ],
  );
  // An alternate recipe of the mod pack, read from a machine running at 66.7%: rates brought back to 100%.
  assert.deepEqual(report.usedBy[1].perMachineAt100, {
    inputs: [{ item: "Iron Plate", perMin: 30 }],
    outputs: [{ item: "Reinforced Iron Plate", perMin: 3 }],
  });
});

test("item_report: an ambiguous or unknown name gives the candidates", async () => {
  assert.match(await failure("item_report", { item: "iron" }), /^Several items match "iron": .*Iron Ingot, Iron Plate/);
  assert.match(await failure("item_report", { item: "plate of iron" }), /^No item named "plate of iron".*Close names: .*Iron Plate/);
  assert.match(await failure("item_report", { item: "unobtainium" }), /The stock tool lists the items in storage/);
});

test("production_balance: deficits worst first, or surpluses largest first", async () => {
  const deficits = await output("production_balance");
  assert.equal(deficits.items.length, 17);
  assert.equal(deficits.items[0].item, "Crushed Siterite");
  assert.deepEqual([deficits.deficits, deficits.surpluses, deficits.balanced, deficits.notShown], [17, 62, 18, 0]);
  assert.ok(deficits.items.every((line: { netPerMin: number }) => line.netPerMin < 0));

  const surpluses = await output("production_balance", { show: "surpluses", limit: 3 });
  assert.deepEqual(
    surpluses.items.map((line: { item: string }) => line.item),
    ["Quickwire", "Coal", "Crushed Gangue"],
  );
  assert.equal(surpluses.notShown, 59);
});

test("machines: filters by state, item and building", async () => {
  const all = await output("machines");
  assert.equal(all.counts.total, 36);
  assert.equal(all.groups.length, 17);

  const stopped = await output("machines", { state: "stopped" });
  assert.equal(stopped.counts.total, 19);
  assert.ok(stopped.groups.every((g: { stopped: number; machines: number }) => g.stopped === g.machines));
  const tinPlate = stopped.groups.find((g: { recipe: string }) => g.recipe === "Tin Plate");
  assert.deepEqual(tinPlate.missingInputs, ["Tin Ingot"]);

  const ironIngot = await output("machines", { item: "iron ingot" });
  assert.deepEqual(
    ironIngot.groups.map((g: { building: string; recipe: string; machines: number }) => [g.building, g.recipe, g.machines]),
    [
      ["Constructor", "Iron Plate", 6],
      ["Constructor", "Iron Rod", 3],
      ["Smelter", "Impure Iron Ingot", 3],
      ["Smelter", "Iron Ingot", 3],
    ],
  );

  const smelters = await output("machines", { building: "smelter", limit: 2 });
  assert.equal(smelters.counts.total, 10);
  assert.equal(smelters.groups.length, 2);
  assert.equal(smelters.notShown, 2);

  assert.match(await failure("machines", { item: "iron" }), /^Several items match "iron"/);
});

test("power: every circuit with something on it, and a total with the worst status", async () => {
  const power = await output("power");
  assert.equal(power.total.status, "short at full load");
  assert.deepEqual(
    power.circuits.map((c: { id: number; status: string; marginMW: number }) => [c.id, c.status, c.marginMW]),
    [
      [2, "short at full load", -314.5],
      [1, "ok", 1132.4],
      [0, "short at full load", -12],
    ],
  );
});

test("stock: largest amounts first, with a search", async () => {
  const ingots = await output("stock", { search: "ingot", limit: 3 });
  assert.deepEqual(
    ingots.items.map((i: { item: string; total: number }) => [i.item, i.total]),
    [
      ["Brass Ingot", 19000],
      ["Copper Ingot", 7689],
      ["Tin Ingot", 5215],
    ],
  );
  assert.equal(ingots.notShown, 5);
});

test("arguments outside the schema are refused before the tool runs", async () => {
  assert.match(await failure("production_balance", { limit: 0 }), /limit/);
  assert.match(await failure("item_report", {}), /item/);
});

test("FRM down: a tool error that explains it, instead of a crash", async () => {
  frm.down = true;
  const message = await failure("factory_overview");
  assert.match(message, /No matching endpoint found/);
  assert.match(message, /restarting/);
});

test("prompts: checkup and production plan, in French unless asked otherwise", async () => {
  const checkup = await client.getPrompt({ name: "factory_checkup", arguments: {} });
  const [message] = checkup.messages;
  assert.equal(message?.role, "user");
  const text = message?.content.type === "text" ? message.content.text : "";
  assert.match(text, /factory_overview/);
  assert.match(text, /Answer in French/);

  const plan = await client.getPrompt({
    name: "plan_production",
    arguments: { item: "Steel Beam", rate: "20", language: "English" },
  });
  const planText = plan.messages[0]?.content.type === "text" ? plan.messages[0].content.text : "";
  assert.match(planText, /20 Steel Beam per minute/);
  assert.match(planText, /Answer in English/);
});

test("read-only for real: FRM only ever received GET requests on read endpoints", () => {
  assert.ok(frm.requests.length > 0);
  for (const request of frm.requests) assert.match(request, /^GET \/get[A-Za-z]+$/);
});
