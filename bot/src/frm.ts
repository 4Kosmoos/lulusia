// Minimal client for the HTTP API of Ficsit Remote Monitoring (FRM).
// Endpoint documentation: https://docs.ficsit.app/ficsitremotemonitoring/latest/

import { config } from "./config.ts";

/** Position in the game world, in centimeters (x towards east, y towards south, z up). */
export interface Location {
  x: number;
  y: number;
  z: number;
}

export interface SessionInfo {
  SessionName: string;
  IsPaused: boolean;
  PassedDays: number;
  Hours: number;
  Minutes: number;
  IsDay: boolean;
  TotalPlayDuration: number;
  TotalPlayDurationText: string;
}

export interface Player {
  ID: string;
  Name: string;
  Online: boolean;
  Dead: boolean;
  PlayerHP: number;
  /** km/h */
  Speed: number;
  location: Location;
}

export interface PowerCircuit {
  CircuitGroupID: number;
  PowerProduction: number;
  PowerConsumed: number;
  PowerCapacity: number;
  PowerMaxConsumed: number;
  BatteryDifferential: number;
  BatteryPercent: number;
  BatteryCapacity: number;
  BatteryTimeEmpty: string;
  BatteryTimeFull: string;
  FuseTriggered: boolean;
}

export interface ChatMessage {
  /** Unix timestamp (seconds). */
  TimeStamp: number;
  /** Seconds since the game was loaded: starts again from zero at every restart. */
  ServerTimeStamp: number;
  Sender: string;
  Type: "System" | "Ada" | "Player";
  Message: string;
}

/** Amount of an item. Fluids are in m³. */
export interface ItemAmount {
  Name: string;
  ClassName: string;
  Amount: number;
}

/** Rates per minute of an item, across all machines, extractors and generators. */
export interface ProductionStat {
  Name: string;
  ClassName: string;
  CurrentProd: number;
  MaxProd: number;
  CurrentConsumed: number;
  MaxConsumed: number;
  Type: "Solid" | "Liquid" | "Gas" | "Invalid" | "Unknown";
}

/** Marker placed on the map by a player. */
export interface MapMarker {
  ID: string;
  Name: string;
  Category: string;
  location: Location;
}

/** Named building (train station, HUB…). */
export interface Building {
  ID: string;
  Name: string;
  location: Location;
}

/** Power switch (simple or priority). */
export interface PowerSwitch {
  ID: string;
  /** Name given to the switch in game, empty if it has none. */
  SwitchTag: string;
  IsOn: boolean;
  /** Priority of a priority switch, -1 for a simple switch. */
  Priority: number;
  location: Location;
}

export interface MachineProduct {
  Name: string;
  /** "Unassigned" for a machine without a recipe. */
  ClassName: string;
  CurrentProd: number;
  MaxProd: number;
}

/** Production machine (constructor, assembler… and modded machines). */
export interface Machine {
  ID: string;
  /** Machine type ("Constructor"). */
  Name: string;
  Recipe: string;
  /** Products of the recipe, main product first. */
  production: MachineProduct[];
  IsProducing: boolean;
  IsPaused: boolean;
  location: Location;
}

interface WriteResult {
  ID?: string;
  IsSent?: boolean;
  error?: string;
}

export class FrmError extends Error {}

const TIMEOUT_MS = 5000;

function errorMessage(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return undefined;
}

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.frmUrl}/${endpoint}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new FrmError(`FRM unreachable (${endpoint})`, { cause });
  }

  const body: unknown = await response.json().catch(() => undefined);
  const error = errorMessage(body);
  if (!response.ok || error !== undefined) {
    const hint =
      error === "No matching endpoint found."
        ? " (known FRM bug after a game reload: restart the server)"
        : "";
    throw new FrmError(`${endpoint}: ${error ?? `HTTP ${response.status}`}${hint}`);
  }
  return body as T;
}

/**
 * Pure ASCII JSON. FRM reads request bodies byte by byte (like Latin-1), which breaks UTF-8:
 * "é" shows up in the game as "Ã©". Non-ASCII characters are therefore sent as \uXXXX escapes,
 * which the game's JSON reader decodes correctly (FRM issue #314).
 */
function asciiJson(payload: object): string {
  return JSON.stringify(payload).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Write endpoints: need the FRM token and return one result per object sent. */
async function post(endpoint: string, payload: object): Promise<WriteResult[]> {
  if (!config.frmToken) {
    throw new FrmError(`FRM_TOKEN missing from .env: cannot call ${endpoint}`);
  }
  const results = await request<WriteResult[]>(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FRM-Authorization": config.frmToken,
    },
    body: asciiJson(payload),
  });
  return Array.isArray(results) ? results : [];
}

/** Like `post`, but fails as soon as one of the results is an error. */
async function write(endpoint: string, payload: object): Promise<WriteResult[]> {
  const list = await post(endpoint, payload);
  const error = list.map(errorMessage).find((message) => message !== undefined);
  if (error !== undefined) throw new FrmError(`${endpoint}: ${error}`);
  return list;
}

/**
 * Turns switches (setSwitches) or machines (setEnabled) on or off in a single call.
 * Returns the IDs actually changed and those that failed (building demolished in the meantime, for example).
 */
async function setStatus(
  endpoint: "setSwitches" | "setEnabled",
  ids: string[],
  on: boolean,
): Promise<{ changed: string[]; failed: string[] }> {
  if (ids.length === 0) return { changed: [], failed: [] };
  const results = await post(endpoint, ids.map((ID) => ({ ID, status: on })));
  const changed = new Set(results.filter((r) => r.error === undefined && r.ID).map((r) => r.ID as string));
  return { changed: [...changed], failed: ids.filter((id) => !changed.has(id)) };
}

/** Color of the sender's name, components from 0 to 1. */
export interface ChatColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

async function sendChatMessage(sender: string, message: string, color?: ChatColor): Promise<void> {
  const [result] = await write("sendChatMessage", color ? { sender, message, color } : { sender, message });
  if (!result?.IsSent) throw new FrmError("sendChatMessage: message rejected by FRM");
}

/** Places a marker ("ping") in the game. FRM refuses if no player is online. */
async function createPing({ x, y, z }: Location): Promise<void> {
  await write("createPing", { x, y, z });
}

export const frm = {
  sessionInfo: () => request<SessionInfo>("getSessionInfo"),
  players: () => request<Player[]>("getPlayer"),
  power: () => request<PowerCircuit[]>("getPower"),
  chatMessages: () => request<ChatMessage[]>("getChatMessages"),
  /** Combined content of all storage containers. */
  storageTotals: () => request<ItemAmount[]>("getWorldInv"),
  /** Content of the dimensional depot. */
  dimensionalDepot: () => request<ItemAmount[]>("getCloudInv"),
  productionStats: () => request<ProductionStat[]>("getProdStats"),
  mapMarkers: () => request<MapMarker[]>("getMapMarkers"),
  trainStations: () => request<Building[]>("getTrainStation"),
  hubTerminals: () => request<Building[]>("getHUBTerminal"),
  switches: () => request<PowerSwitch[]>("getSwitches"),
  machines: () => request<Machine[]>("getFactory"),
  sendChatMessage,
  createPing,
  setSwitches: (ids: string[], on: boolean) => setStatus("setSwitches", ids, on),
  setMachines: (ids: string[], on: boolean) => setStatus("setEnabled", ids, on),
};
