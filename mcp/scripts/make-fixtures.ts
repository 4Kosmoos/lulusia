// Builds the test fixtures (test/fixtures/) from real FRM answers saved in docs/prive/frm-samples/
// (private, never committed): a small, anonymized slice of the real factory.
//
//   node mcp/scripts/make-fixtures.ts      (from the root of the repo)
//
// Anonymized: session name, player names and IDs, map seed, player inventories.
// Reduced: 36 machines out of ~400, chosen to cover every machine state; one of them is set to paused.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SAMPLES = new URL("../../docs/prive/frm-samples/", import.meta.url);
const FIXTURES = new URL("../test/fixtures/", import.meta.url);

type Sample = Record<string, unknown>;
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`${name}.json`, SAMPLES), "utf8")) as T;
const write = (name: string, value: unknown) =>
  writeFileSync(new URL(`${name}.json`, FIXTURES), `${JSON.stringify(value, null, 1)}\n`);

/** Recipes kept, and how many machines of each. */
const KEPT: [building: string, recipe: string, count: number][] = [
  ["Constructor", "Copper Rod", 4],
  ["Constructor", "Iron Plate", 6],
  ["Constructor", "Iron Rod", 3],
  ["Constructor", "Wire", 2],
  ["Constructor", "Screws", 1],
  ["Constructor", "Alternate: Compacted Iron Plate", 1],
  ["Constructor", "Solid Biofuel", 1],
  ["Constructor", "Biomass (Wood)", 1],
  ["Constructor", "Biomass (Leaves)", 1],
  ["Smelter", "Impure Iron Ingot", 3],
  ["Smelter", "Iron Ingot", 3],
  ["Smelter", "Tin Ingot", 2],
  ["Smelter", "Impure Copper Ingot", 2],
  ["Assembler", "Tin Plate", 1],
  ["Assembler", "Stator", 2],
  ["Assembler", "Smart Plating", 2],
  ["Assembler", "Poled Kerr Crystal", 1],
];

mkdirSync(FIXTURES, { recursive: true });

const session = read<Sample>("getSessionInfo");
write("getSessionInfo", {
  SessionName: "Test session",
  IsPaused: session.IsPaused,
  PassedDays: session.PassedDays,
  Hours: session.Hours,
  Minutes: session.Minutes,
  IsDay: session.IsDay,
  TotalPlayDuration: session.TotalPlayDuration,
  TotalPlayDurationText: session.TotalPlayDurationText,
});

write(
  "getPlayer",
  read<Sample[]>("getPlayer").map((player, index) => ({
    ID: `Player_${index + 1}`,
    Name: `Player ${index + 1}`,
    Online: index === 0,
    Dead: false,
    PlayerHP: 100,
    Speed: 0,
    location: player.location,
  })),
);

for (const name of ["getPower", "getProdStats", "getWorldInv", "getCloudInv"]) write(name, read<unknown>(name));

/** Stopped and producing machines in turn, starting with a stopped one, so that every state is covered. */
function alternate(machines: Sample[]): Sample[] {
  const stopped = machines.filter((m) => !m.IsProducing);
  const producing = machines.filter((m) => m.IsProducing);
  return Array.from({ length: Math.max(stopped.length, producing.length) }, (_, i) => [stopped[i], producing[i]])
    .flat()
    .filter((m) => m !== undefined);
}

const factory = read<Sample[]>("getFactory");
const machines = KEPT.flatMap(([building, recipe, count]) =>
  alternate(factory.filter((m) => m.Name === building && m.Recipe === recipe)).slice(0, count),
).map(({ features, BoundingBox, ColorSlot, ...machine }) => machine);
// No machine is paused in the real factory: pause the first Copper Rod constructor (it was stopped).
Object.assign(machines[0], { IsPaused: true, IsProducing: false });
write("getFactory", machines);
console.log(`${machines.length} machines written to ${FIXTURES.pathname}`);
