// Heartbeat for Healthchecks.io: the bot calls a URL every minute. If the calls stop (VPS down,
// bot stopped or crashed), Healthchecks.io warns on Discord. This covers the failures the bot
// cannot report itself.

import { config } from "./config.ts";

const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;

export function startHeartbeat(): void {
  const url = config.healthcheckUrl;
  if (!url) {
    console.log("Heartbeat disabled (HEALTHCHECK_URL missing from .env).");
    return;
  }

  let failing = false;
  const beat = async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (failing) console.log("Heartbeat: delivered again.");
      failing = false;
    } catch (error) {
      // The URL is never written to the logs: it can be used to send fake signals.
      if (!failing) console.warn("Heartbeat failed:", error instanceof Error ? error.message : error);
      failing = true;
    }
  };
  void beat();
  setInterval(beat, INTERVAL_MS);
  console.log("Heartbeat active (Healthchecks.io, every minute).");
}
