// Surveillance du serveur : prévient dans #alertes quand le serveur de jeu ou FRM ne répond plus,
// et quand la RAM ou le disque du VPS saturent. Un message quand le problème commence, un quand il cesse.
//
// Le conteneur du bot voit la RAM de la machine (/proc/meminfo) et le disque qui porte Docker,
// c'est-à-dire le disque principal du VPS. Si le VPS ou le bot lui-même tombe, aucune alerte ne part :
// le message de #statut cesse alors d'être mis à jour.

import { readFile, statfs } from "node:fs/promises";
import { ChannelType, type Client } from "discord.js";
import { config } from "./config.ts";
import { formatDuration, formatNumber } from "./format.ts";
import { frm } from "./frm.ts";

const CHECK_INTERVAL_MS = 60_000;
/** Délai avant d'alerter : laisse passer un redémarrage normal (2 à 3 min de chargement de la carte). */
const DOWN_ALERT_AFTER_MS = 5 * 60_000;
/**
 * Redémarrages planifiés chaque jour, en UTC : rechargement de la partie à 04:00, puis redémarrage
 * complet à 04:10 (ops/systemd). Une panne pendant ce créneau n'est signalée que si elle dure après.
 */
const PLANNED_RESTART_UTC = { from: 4 * 60, to: 4 * 60 + 20 }; // en minutes depuis minuit
/** Seuils en % d'utilisation : alerte à partir de `alert`, fin d'alerte sous `clear` (évite les allers-retours). */
const RAM = { alert: 90, clear: 85, afterMs: 4 * 60_000 }; // un pic de quelques minutes ne compte pas
const DISK = { alert: 90, clear: 85, afterMs: 0 };

export type IncidentEvent = { kind: "start" | "end"; elapsedMs: number };

/** Suit un problème qui dure : signale son début après `delayMs` (hors créneau silencieux), puis sa fin. */
export class Incident {
  #since: number | undefined;
  #reported = false;
  readonly #delayMs: number;
  readonly #isQuiet: (now: Date) => boolean;

  constructor(delayMs: number, isQuiet: (now: Date) => boolean = () => false) {
    this.#delayMs = delayMs;
    this.#isQuiet = isQuiet;
  }

  /** Vrai une fois le début du problème signalé, jusqu'à sa fin. */
  get reported(): boolean {
    return this.#reported;
  }

  update(failing: boolean, now: number): IncidentEvent | undefined {
    const elapsedMs = this.#since === undefined ? 0 : now - this.#since;
    if (!failing) {
      const wasReported = this.#reported;
      this.#since = undefined;
      this.#reported = false;
      return wasReported ? { kind: "end", elapsedMs } : undefined;
    }
    this.#since ??= now;
    if (!this.#reported && elapsedMs >= this.#delayMs && !this.#isQuiet(new Date(now))) {
      this.#reported = true;
      return { kind: "start", elapsedMs };
    }
    return undefined;
  }
}

export function inPlannedRestart(date: Date): boolean {
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return minutes >= PLANNED_RESTART_UTC.from && minutes < PLANNED_RESTART_UTC.to;
}

interface Usage {
  percent: number;
  freeGb: number;
  totalGb: number;
}

/** RAM de la machine, comptée comme `free` : la mémoire « disponible » inclut le cache libérable. */
export async function memoryUsage(): Promise<Usage> {
  const info = await readFile("/proc/meminfo", "utf8");
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(info)?.[1]);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!total || Number.isNaN(available)) throw new Error("/proc/meminfo illisible");
  return { percent: 100 * (1 - available / total), freeGb: available / 1024 ** 2, totalGb: total / 1024 ** 2 };
}

/** Disque, compté comme `df` : la place réservée à root n'est pas comptée comme libre. */
export async function diskUsage(path = "/"): Promise<Usage> {
  const stats = await statfs(path);
  const used = (stats.blocks - stats.bfree) * stats.bsize;
  const free = stats.bavail * stats.bsize;
  return { percent: (100 * used) / (used + free), freeGb: free / 1024 ** 3, totalGb: (stats.blocks * stats.bsize) / 1024 ** 3 };
}

const gb = (value: number) => `${formatNumber(value)} Go`;
const minutes = (ms: number) => formatDuration(ms / 60_000);

function downText(error: unknown, elapsedMs: number): string {
  const reason = error instanceof Error ? error.message : String(error);
  const cause = reason.includes("No matching endpoint")
    ? "FRM est en panne (bug connu après un rechargement de la partie). Redémarrer le serveur : `sudo systemctl restart satisfactory`."
    : `Serveur de jeu arrêté ou planté, ou FRM injoignable. Vérifier avec \`lulusia-status\`.\n\`${reason}\``;
  return `🔴 **Le serveur de jeu ne répond plus** depuis ${minutes(elapsedMs)}.\n${cause}`;
}

/**
 * Crée la surveillance. `say` envoie un message dans le salon des alertes.
 * `check` fait une vérification complète ; `now` n'est passé que par les tests.
 */
export function createMonitor(say: (text: string) => Promise<void>) {
  const server = new Incident(DOWN_ALERT_AFTER_MS, inPlannedRestart);
  const ram = new Incident(RAM.afterMs);
  const disk = new Incident(DISK.afterMs);

  async function checkServer(now: number): Promise<void> {
    let error: unknown;
    try {
      await frm.sessionInfo();
    } catch (caught) {
      error = caught;
    }
    const event = server.update(error !== undefined, now);
    if (event?.kind === "start") await say(downText(error, event.elapsedMs));
    if (event?.kind === "end") await say(`🟢 **Le serveur de jeu répond de nouveau** (panne de ${minutes(event.elapsedMs)}).`);
  }

  async function checkGauge(
    incident: Incident,
    usage: Usage,
    limits: { alert: number; clear: number },
    label: { name: string; full: string; hint: string },
    now: number,
  ): Promise<void> {
    // Hystérésis : une fois l'alerte lancée, elle ne cesse que sous le seuil `clear`.
    const failing = usage.percent >= (incident.reported ? limits.clear : limits.alert);
    const event = incident.update(failing, now);
    const percent = `${formatNumber(usage.percent)} %`;
    if (event?.kind === "start") {
      await say(`🟠 **${label.full}** : ${percent} (${gb(usage.freeGb)} libres sur ${gb(usage.totalGb)}).\n${label.hint}`);
    }
    if (event?.kind === "end") await say(`🟢 ${label.name} : retour à ${percent}.`);
  }

  async function check(now = Date.now()): Promise<void> {
    await checkServer(now);
    await checkGauge(ram, await memoryUsage(), RAM, {
      name: "RAM",
      full: "RAM presque pleine",
      hint: "Si ça se répète, envisager le passage au VPS-4 (docs/architecture.md).",
    }, now);
    await checkGauge(disk, await diskUsage(), DISK, {
      name: "Disque",
      full: "Disque presque plein",
      hint: "Pistes : `sudo docker image prune`, `journalctl --disk-usage`, archives de `/var/backups/lulusia`.",
    }, now);
  }

  return { check };
}

export async function startMonitoring(client: Client<true>): Promise<void> {
  if (!config.alertChannelId) {
    console.log("Surveillance désactivée (ALERT_CHANNEL_ID absent du .env).");
    return;
  }
  const channel = await client.channels.fetch(config.alertChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`ALERT_CHANNEL_ID (${config.alertChannelId}) n'est pas un salon textuel accessible au bot`);
  }

  const monitor = createMonitor(async (text) => {
    console.log(`Alerte : ${text.split("\n")[0]}`);
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await monitor.check();
    } catch (error) {
      console.error("Surveillance : vérification impossible :", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, CHECK_INTERVAL_MS);

  const [ram, disk] = await Promise.all([memoryUsage(), diskUsage()]);
  console.log(
    `Surveillance active dans #${channel.name} : RAM ${formatNumber(ram.percent)} % (${gb(ram.totalGb)}), ` +
      `disque ${formatNumber(disk.percent)} % (${gb(disk.totalGb)}).`,
  );
}
