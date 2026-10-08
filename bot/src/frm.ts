// Client minimal pour l'API HTTP de Ficsit Remote Monitoring (FRM).
// Documentation des endpoints : https://docs.ficsit.app/ficsitremotemonitoring/latest/

import { config } from "./config.ts";

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

interface SendChatResult {
  IsSent?: boolean;
  Message?: string;
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
    // "No matching endpoint found." = le bug FRM après un rechargement de la partie.
    throw new FrmError(`${endpoint} : ${error ?? `HTTP ${response.status}`}`);
  }
  return body as T;
}

async function sendChatMessage(sender: string, message: string): Promise<void> {
  if (!config.frmToken) {
    throw new FrmError("FRM_TOKEN manquant dans le .env : impossible d'écrire dans le chat du jeu");
  }
  const results = await request<SendChatResult[]>("sendChatMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FRM-Authorization": config.frmToken,
    },
    body: JSON.stringify({ sender, message }),
  });
  const result = Array.isArray(results) ? results[0] : undefined;
  if (!result?.IsSent) {
    throw new FrmError(`sendChatMessage : ${result?.error ?? "message refusé par FRM"}`);
  }
}

export const frm = {
  sessionInfo: () => request<SessionInfo>("getSessionInfo"),
  players: () => request<Player[]>("getPlayer"),
  power: () => request<PowerCircuit[]>("getPower"),
  chatMessages: () => request<ChatMessage[]>("getChatMessages"),
  sendChatMessage,
};
