// Server monitoring: warns in #alertes when the game server or FRM stops answering, and when the
// VPS's RAM or disk fills up. One message when the problem starts, one when it ends.
//
// The bot's container sees the machine's RAM (/proc/meminfo) and the disk that holds Docker,
// i.e. the VPS's main disk. If the VPS or the bot itself goes down, the heartbeat
// (heartbeat.ts, Healthchecks.io) is what warns.

import { readFile, statfs } from "node:fs/promises";
import { ChannelType, type Client } from "discord.js";
import { config } from "./config.ts";
import { formatDuration, formatNumber, percent } from "./format.ts";
import { frm } from "./frm.ts";

const CHECK_INTERVAL_MS = 60_000;
/** Delay before alerting: lets a normal restart go through (2 to 3 min to load the map). */
const DOWN_ALERT_AFTER_MS = 5 * 60_000;
/**
 * Daily planned restarts, in UTC: game reload at 04:00, then full restart at 04:10 (ops/systemd).
 * An outage during this window is only reported if it lasts beyond it.
 */
const PLANNED_RESTART_UTC = { from: 4 * 60, to: 4 * 60 + 20 }; // in minutes since midnight
/** Thresholds in % used: alert from `alert`, end of alert below `clear` (avoids back and forth). */
const RAM = { alert: 90, clear: 85, afterMs: 4 * 60_000 }; // a spike of a few minutes does not count
const DISK = { alert: 90, clear: 85, afterMs: 0 };

export type IncidentEvent = { kind: "start" | "end"; elapsedMs: number };

/** Tracks a lasting problem: reports its start after `delayMs` (outside the quiet window), then its end. */
export class Incident {
  #since: number | undefined;
  #reported = false;
  readonly #delayMs: number;
  readonly #isQuiet: (now: Date) => boolean;

  constructor(delayMs: number, isQuiet: (now: Date) => boolean = () => false) {
    this.#delayMs = delayMs;
    this.#isQuiet = isQuiet;
  }

  /** True once the start of the problem has been reported, until it ends. */
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

/** The machine's RAM, counted like `free`: "available" memory includes the cache that can be freed. */
export async function memoryUsage(): Promise<Usage> {
  const info = await readFile("/proc/meminfo", "utf8");
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(info)?.[1]);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!total || Number.isNaN(available)) throw new Error("cannot read /proc/meminfo");
  return { percent: 100 * (1 - available / total), freeGb: available / 1024 ** 2, totalGb: total / 1024 ** 2 };
}

/** Disk, counted like `df`: the space reserved for root is not counted as free. */
export async function diskUsage(path = "/"): Promise<Usage> {
  const stats = await statfs(path);
  const used = (stats.blocks - stats.bfree) * stats.bsize;
  const free = stats.bavail * stats.bsize;
  return { percent: (100 * used) / (used + free), freeGb: free / 1024 ** 3, totalGb: (stats.blocks * stats.bsize) / 1024 ** 3 };
}

const gb = (value: number) => `${formatNumber(value)} GB`;
const minutes = (ms: number) => formatDuration(ms / 60_000);

function downText(error: unknown, elapsedMs: number): string {
  const reason = error instanceof Error ? error.message : String(error);
  const cause = reason.includes("No matching endpoint")
    ? "FRM is down (known bug after a game reload). The watchdog restarts the server within 10 min " +
      "(at most 3 times a day). If it does not come back: `sudo systemctl restart satisfactory`."
    : `Game server stopped or crashed, or FRM unreachable. Check with \`lulusia-status\`.\n\`${reason}\``;
  return `🔴 **The game server has not been responding** for ${minutes(elapsedMs)}.\n${cause}`;
}

/**
 * Creates the monitoring. `say` sends a message to the alerts channel.
 * `check` runs a full check; `now` is only passed by tests.
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
    if (event?.kind === "end") await say(`🟢 **The game server is responding again** (down for ${minutes(event.elapsedMs)}).`);
  }

  async function checkGauge(
    incident: Incident,
    usage: Usage,
    limits: { alert: number; clear: number },
    label: { name: string; full: string; hint: string },
    now: number,
  ): Promise<void> {
    // Hysteresis: once the alert has started, it only ends below the `clear` threshold.
    const failing = usage.percent >= (incident.reported ? limits.clear : limits.alert);
    const event = incident.update(failing, now);
    const used = percent(usage.percent);
    if (event?.kind === "start") {
      await say(`🟠 **${label.full}**: ${used} (${gb(usage.freeGb)} free of ${gb(usage.totalGb)}).\n${label.hint}`);
    }
    if (event?.kind === "end") await say(`🟢 ${label.name}: back to ${used}.`);
  }

  async function check(now = Date.now()): Promise<void> {
    await checkServer(now);
    await checkGauge(ram, await memoryUsage(), RAM, {
      name: "RAM",
      full: "RAM almost full",
      hint: "If it happens again, consider moving to the VPS-4 (docs/architecture.md).",
    }, now);
    await checkGauge(disk, await diskUsage(), DISK, {
      name: "Disk",
      full: "Disk almost full",
      hint: "Ideas: `sudo docker image prune`, `journalctl --disk-usage`, archives in `/var/backups/lulusia`.",
    }, now);
  }

  return { check };
}

export async function startMonitoring(client: Client<true>): Promise<void> {
  if (!config.alertChannelId) {
    console.log("Monitoring disabled (ALERT_CHANNEL_ID missing from .env).");
    return;
  }
  const channel = await client.channels.fetch(config.alertChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`ALERT_CHANNEL_ID (${config.alertChannelId}) is not a text channel the bot can access`);
  }

  const monitor = createMonitor(async (text) => {
    console.log(`Alert: ${text.split("\n")[0]}`);
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await monitor.check();
    } catch (error) {
      console.error("Monitoring: check failed:", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, CHECK_INTERVAL_MS);

  const [ram, disk] = await Promise.all([memoryUsage(), diskUsage()]);
  console.log(
    `Monitoring active in #${channel.name}: RAM ${percent(ram.percent)} (${gb(ram.totalGb)}), ` +
      `disk ${percent(disk.percent)} (${gb(disk.totalGb)}).`,
  );
}
