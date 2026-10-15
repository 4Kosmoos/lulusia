// Client minimal pour l'API HTTP de Ficsit Remote Monitoring (FRM).
// Documentation des endpoints : https://docs.ficsit.app/ficsitremotemonitoring/latest/

import { config } from "./config.ts";

/** Position dans le monde du jeu, en centimètres (x vers l'est, y vers le sud, z vers le haut). */
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
  /** Horodatage Unix (secondes). */
  TimeStamp: number;
  /** Secondes depuis le chargement de la partie : repart de zéro à chaque redémarrage. */
  ServerTimeStamp: number;
  Sender: string;
  Type: "System" | "Ada" | "Player";
  Message: string;
}

/** Quantité d'un objet. Les fluides sont en m³. */
export interface ItemAmount {
  Name: string;
  ClassName: string;
  Amount: number;
}

/** Rythmes par minute d'un objet, toutes machines, extracteurs et générateurs confondus. */
export interface ProductionStat {
  Name: string;
  ClassName: string;
  CurrentProd: number;
  MaxProd: number;
  CurrentConsumed: number;
  MaxConsumed: number;
  Type: "Solid" | "Liquid" | "Gas" | "Invalid" | "Unknown";
}

/** Marqueur posé sur la carte par un joueur. */
export interface MapMarker {
  ID: string;
  Name: string;
  Category: string;
  location: Location;
}

/** Bâtiment nommé (gare, HUB…). */
export interface Building {
  ID: string;
  Name: string;
  location: Location;
}

/** Interrupteur électrique (simple ou prioritaire). */
export interface PowerSwitch {
  ID: string;
  /** Nom donné en jeu à l'interrupteur, vide s'il n'en a pas. */
  SwitchTag: string;
  IsOn: boolean;
  /** Priorité d'un interrupteur prioritaire, -1 pour un interrupteur simple. */
  Priority: number;
  location: Location;
}

export interface MachineProduct {
  Name: string;
  /** « Unassigned » pour une machine sans recette. */
  ClassName: string;
  CurrentProd: number;
  MaxProd: number;
}

/** Machine de production (constructeur, assembleuse… et machines des mods). */
export interface Machine {
  ID: string;
  /** Type de machine (« Constructor »). */
  Name: string;
  Recipe: string;
  /** Produits de la recette, le produit principal en premier. */
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
    throw new FrmError(`FRM injoignable (${endpoint})`, { cause });
  }

  const body: unknown = await response.json().catch(() => undefined);
  const error = errorMessage(body);
  if (!response.ok || error !== undefined) {
    const hint =
      error === "No matching endpoint found."
        ? " (bug FRM connu après un rechargement de la partie : redémarrer le serveur)"
        : "";
    throw new FrmError(`${endpoint} : ${error ?? `HTTP ${response.status}`}${hint}`);
  }
  return body as T;
}

/**
 * JSON en ASCII pur. FRM lit le corps des requêtes octet par octet (comme du Latin-1), ce qui casse
 * l'UTF-8 : « é » arrive dans le jeu sous la forme « Ã© ». Les caractères non ASCII partent donc en
 * séquences \uXXXX, que le lecteur JSON du jeu décode correctement.
 */
function asciiJson(payload: object): string {
  return JSON.stringify(payload).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Endpoints d'écriture : demandent le jeton FRM et renvoient un résultat par objet envoyé. */
async function post(endpoint: string, payload: object): Promise<WriteResult[]> {
  if (!config.frmToken) {
    throw new FrmError(`FRM_TOKEN manquant dans le .env : ${endpoint} impossible`);
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

/** Comme `post`, mais échoue dès qu'un des résultats est une erreur. */
async function write(endpoint: string, payload: object): Promise<WriteResult[]> {
  const list = await post(endpoint, payload);
  const error = list.map(errorMessage).find((message) => message !== undefined);
  if (error !== undefined) throw new FrmError(`${endpoint} : ${error}`);
  return list;
}

/**
 * Allume ou éteint des interrupteurs (setSwitches) ou des machines (setEnabled) d'un seul appel.
 * Renvoie les ID réellement modifiés et ceux en échec (bâtiment démoli entre-temps, par exemple).
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

/** Couleur du nom de l'expéditeur, composantes de 0 à 1. */
export interface ChatColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

async function sendChatMessage(sender: string, message: string, color?: ChatColor): Promise<void> {
  const [result] = await write("sendChatMessage", color ? { sender, message, color } : { sender, message });
  if (!result?.IsSent) throw new FrmError("sendChatMessage : message refusé par FRM");
}

/** Pose un marqueur (« ping ») dans le jeu. FRM refuse si aucun joueur n'est connecté. */
async function createPing({ x, y, z }: Location): Promise<void> {
  await write("createPing", { x, y, z });
}

export const frm = {
  sessionInfo: () => request<SessionInfo>("getSessionInfo"),
  players: () => request<Player[]>("getPlayer"),
  power: () => request<PowerCircuit[]>("getPower"),
  chatMessages: () => request<ChatMessage[]>("getChatMessages"),
  /** Contenu cumulé de tous les conteneurs de stockage. */
  storageTotals: () => request<ItemAmount[]>("getWorldInv"),
  /** Contenu du dépôt dimensionnel. */
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
