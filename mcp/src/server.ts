// The MCP server: read-only tools on the live factory, and two prompts.

import { McpServer } from "@modelcontextprotocol/server";
import type { FactoryData } from "./data.ts";
import { registerPrompts } from "./prompts.ts";
import { registerProductionBalance } from "./tools/balance.ts";
import { registerItemReport } from "./tools/item.ts";
import { registerMachines } from "./tools/machines.ts";
import { registerOverview } from "./tools/overview.ts";
import { registerPower } from "./tools/power.ts";
import { registerStock } from "./tools/stock.ts";

export const VERSION = "0.1.0";

/** What the model learns about the server when it connects. */
const INSTRUCTIONS = [
  "Live data from Lulusia, a modded Satisfactory server (mod pack Satisfactory Plus, with Refined Power and",
  "other mods), read through the Ficsit Remote Monitoring mod. Read-only: nothing here changes the game.",
  "Items, buildings and recipes have the game's English names. The mod pack changes many recipes and adds",
  "items: trust the recipes the tools show (item_report, machines) over vanilla Satisfactory knowledge.",
  "Rates are per minute, power in MW, fluids in m³. Data is at most 10 seconds old.",
].join(" ");

export function createServer(data: FactoryData): McpServer {
  const server = new McpServer({ name: "lulusia", version: VERSION }, { instructions: INSTRUCTIONS });
  registerOverview(server, data);
  registerItemReport(server, data);
  registerProductionBalance(server, data);
  registerMachines(server, data);
  registerPower(server, data);
  registerStock(server, data);
  registerPrompts(server);
  return server;
}
