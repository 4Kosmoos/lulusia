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

interface WriteResult {
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

/** Endpoints d'écriture : demandent le jeton FRM et renvoient un résultat par objet envoyé. */
async function write(endpoint: string, payload: object): Promise<WriteResult[]> {
  if (!config.frmToken) {
    throw new FrmError(`FRM_TOKEN manquant dans le .env : ${endpoint} impossible`);
  }
  const results = await request<WriteResult[]>(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FRM-Authorization": config.frmToken,
    },
    body: JSON.stringify(payload),
  });
  const list = Array.isArray(results) ? results : [];
  const error = list.map(errorMessage).find((message) => message !== undefined);
  if (error !== undefined) throw new FrmError(`${endpoint} : ${error}`);
  return list;
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
  sendChatMessage,
  createPing,
};
