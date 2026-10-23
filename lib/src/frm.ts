// Typed client for the HTTP API of Ficsit Remote Monitoring (FRM), shared by the bot and the MCP server.
// Endpoint documentation: https://docs.ficsit.app/ficsitremotemonitoring/latest/
//
// Two entry points:
// - createFrmReader: read endpoints only. Nothing in it can change the game (used by the MCP server).
// - createFrmClient: read and write endpoints (chat, pings, switches, machines), with FRM's token (used by the bot).
//
// Not exposed on purpose: getRecipes and getSchematics crash the game server with our mod list (FRM 1.5.4,
// getRecipe dereferences a recipe that a mod lists but that does not exist, before checking it).

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

/** Item made by a machine. Rates are per minute, at the machine's clock speed. */
export interface MachineProduct {
  Name: string;
  /** "Unassigned" for a machine without a recipe. */
  ClassName: string;
  /** Amount made per cycle. */
  Amount: number;
  CurrentProd: number;
  MaxProd: number;
}

/** Item used by a machine. Rates are per minute, at the machine's clock speed. */
export interface MachineIngredient {
  Name: string;
  ClassName: string;
  /** Amount used per cycle. */
  Amount: number;
  CurrentConsumed: number;
  MaxConsumed: number;
}

/** Content of one input or output slot of a machine. */
export interface MachineSlot {
  Name: string;
  ClassName: string;
  Amount: number;
  /** Size of the slot (a stack). */
  MaxAmount: number;
}

export interface MachinePower {
  CircuitGroupID: number;
  CircuitID: number;
  FuseTriggered: boolean;
  /** MW. A powered machine draws a little even when it does not produce. */
  PowerConsumed: number;
  MaxPowerConsumed: number;
}

/** Production machine (constructor, assembler… and modded machines). */
export interface Machine {
  ID: string;
  /** Machine type ("Constructor"). */
  Name: string;
  Recipe: string;
  /** Products of the recipe, main product first. */
  production: MachineProduct[];
  ingredients: MachineIngredient[];
  /** Slots with something in them: an empty slot is not listed. */
  InputInventory: MachineSlot[];
  OutputInventory: MachineSlot[];
  /** Share of the recent time spent producing, in %. */
  Productivity: number;
  /** Clock speed in % (100 is the normal speed). */
  ManuSpeed: number;
  Somersloops: number;
  PowerShards: number;
  IsConfigured: boolean;
  IsProducing: boolean;
  IsPaused: boolean;
  PowerInfo: MachinePower;
  location: Location;
}

/** Color of the sender's name, components from 0 to 1. */
export interface ChatColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Result of turning switches or machines on or off. */
export interface StatusChange {
  /** IDs actually changed. */
  changed: string[];
  /** IDs that failed (building demolished in the meantime, for example). */
  failed: string[];
}

/** Read endpoints. */
export interface FrmReader {
  sessionInfo(): Promise<SessionInfo>;
  players(): Promise<Player[]>;
  power(): Promise<PowerCircuit[]>;
  chatMessages(): Promise<ChatMessage[]>;
  /** Combined content of all storage containers. */
  storageTotals(): Promise<ItemAmount[]>;
  /** Content of the dimensional depot. */
  dimensionalDepot(): Promise<ItemAmount[]>;
  productionStats(): Promise<ProductionStat[]>;
  mapMarkers(): Promise<MapMarker[]>;
  trainStations(): Promise<Building[]>;
  hubTerminals(): Promise<Building[]>;
  switches(): Promise<PowerSwitch[]>;
  machines(): Promise<Machine[]>;
}

/** Read and write endpoints. Writes need FRM's token. */
export interface FrmClient extends FrmReader {
  sendChatMessage(sender: string, message: string, color?: ChatColor): Promise<void>;
  /** Places a marker ("ping") in the game. FRM refuses if no player is online. */
  createPing(location: Location): Promise<void>;
  setSwitches(ids: string[], on: boolean): Promise<StatusChange>;
  setMachines(ids: string[], on: boolean): Promise<StatusChange>;
}

export interface FrmReaderOptions {
  /** Address of FRM's web server ("http://localhost:8080"). */
  url: string;
  /** Time given to FRM for each request. Default: 5 s. */
  timeoutMs?: number;
}

export interface FrmClientOptions extends FrmReaderOptions {
  /** FRM's API token (X-FRM-Authorization header), needed by write endpoints only. */
  token?: string;
}

export class FrmError extends Error {}

const DEFAULT_TIMEOUT_MS = 5000;

interface WriteResult {
  ID?: string;
  IsSent?: boolean;
  error?: string;
}

type Request = <T>(endpoint: string, init?: RequestInit) => Promise<T>;

function errorMessage(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return undefined;
}

function createRequest({ url, timeoutMs = DEFAULT_TIMEOUT_MS }: FrmReaderOptions): Request {
  const base = url.replace(/\/+$/, "");
  return async <T>(endpoint: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${base}/${endpoint}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
  };
}

function readEndpoints(request: Request): FrmReader {
  return {
    sessionInfo: () => request<SessionInfo>("getSessionInfo"),
    players: () => request<Player[]>("getPlayer"),
    power: () => request<PowerCircuit[]>("getPower"),
    chatMessages: () => request<ChatMessage[]>("getChatMessages"),
    storageTotals: () => request<ItemAmount[]>("getWorldInv"),
    dimensionalDepot: () => request<ItemAmount[]>("getCloudInv"),
    productionStats: () => request<ProductionStat[]>("getProdStats"),
    mapMarkers: () => request<MapMarker[]>("getMapMarkers"),
    trainStations: () => request<Building[]>("getTrainStation"),
    hubTerminals: () => request<Building[]>("getHUBTerminal"),
    switches: () => request<PowerSwitch[]>("getSwitches"),
    machines: () => request<Machine[]>("getFactory"),
  };
}

/** Client limited to the read endpoints: it has no method that changes the game, and no token. */
export function createFrmReader(options: FrmReaderOptions): FrmReader {
  return readEndpoints(createRequest(options));
}

/**
 * Pure ASCII JSON. FRM reads request bodies byte by byte (like Latin-1), which breaks UTF-8:
 * "é" shows up in the game as "Ã©". Non-ASCII characters are therefore sent as \uXXXX escapes,
 * which the game's JSON reader decodes correctly (FRM issue #314).
 */
function asciiJson(payload: object): string {
  return JSON.stringify(payload).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Client with the read and write endpoints. Writes fail with an FrmError if `token` is missing. */
export function createFrmClient(options: FrmClientOptions): FrmClient {
  const request = createRequest(options);

  /** Write endpoints: need the token and return one result per object sent. */
  async function post(endpoint: string, payload: object): Promise<WriteResult[]> {
    if (!options.token) {
      throw new FrmError(`FRM token missing (FRM_TOKEN): cannot call ${endpoint}`);
    }
    const results = await request<WriteResult[]>(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FRM-Authorization": options.token,
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

  /** Turns switches (setSwitches) or machines (setEnabled) on or off in a single call. */
  async function setStatus(endpoint: "setSwitches" | "setEnabled", ids: string[], on: boolean): Promise<StatusChange> {
    if (ids.length === 0) return { changed: [], failed: [] };
    const results = await post(endpoint, ids.map((ID) => ({ ID, status: on })));
    const changed = new Set(results.filter((r) => r.error === undefined && r.ID).map((r) => r.ID as string));
    return { changed: [...changed], failed: ids.filter((id) => !changed.has(id)) };
  }

  return {
    ...readEndpoints(request),
    async sendChatMessage(sender, message, color) {
      const [result] = await write("sendChatMessage", color ? { sender, message, color } : { sender, message });
      if (!result?.IsSent) throw new FrmError("sendChatMessage: message rejected by FRM");
    },
    async createPing({ x, y, z }) {
      await write("createPing", { x, y, z });
    },
    setSwitches: (ids, on) => setStatus("setSwitches", ids, on),
    setMachines: (ids, on) => setStatus("setEnabled", ids, on),
  };
}
