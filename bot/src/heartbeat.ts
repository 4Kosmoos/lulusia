// Signal de vie pour Healthchecks.io : le bot appelle une URL chaque minute. Si les appels cessent
// (VPS en panne, bot arrêté ou planté), Healthchecks.io prévient sur Discord. C'est ce qui couvre
// les pannes que le bot ne peut pas signaler lui-même.

import { config } from "./config.ts";

const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;

export function startHeartbeat(): void {
  const url = config.healthcheckUrl;
  if (!url) {
    console.log("Signal de vie désactivé (HEALTHCHECK_URL absent du .env).");
    return;
  }

  let failing = false;
  const beat = async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (failing) console.log("Signal de vie : de nouveau transmis.");
      failing = false;
    } catch (error) {
      // L'URL n'est jamais écrite dans les logs : elle permet d'envoyer de faux signaux.
      if (!failing) console.warn("Signal de vie impossible :", error instanceof Error ? error.message : error);
      failing = true;
    }
  };
  void beat();
  setInterval(beat, INTERVAL_MS);
  console.log("Signal de vie actif (Healthchecks.io, toutes les minutes).");
}
