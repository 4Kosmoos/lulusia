// Custom alerts: "warn me when the Iron Plate stock drops below 1,000", "…when Iron Ingot is consumed
// faster than it is produced". Rules are created with /alert (Discord) or !alert (game) and saved in
// data/alerts.json (a Docker volume in production). Checked every minute, they warn in #alertes and in
// the game chat, when the problem starts and when it ends.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ChannelType, escapeMarkdown, type Client } from "discord.js";
import { capitalize, formatDuration, formatInteger } from "@lulusia/lib/format";
import { BALANCED, reportFor, type Item, type ItemReport } from "@lulusia/lib/inventory";
import { amountText, loadInventory, ratesText } from "./commands/inventory.ts";
import { config } from "./config.ts";
import { botSays } from "./game-chat.ts";
import { Incident, type IncidentEvent } from "./monitor.ts";

export type AlertKind = "stock" | "deficit";

export interface AlertRule {
  /** Number shown to players and used to remove the alert. */
  id: number;
  kind: AlertKind;
  className: string;
  /** Item name when the alert was created. */
  name: string;
  /** For "stock": alert when the stock drops below this threshold. */
  threshold?: number;
  createdBy: string;
  createdAt: string;
}

const FILE = new URL("../data/alerts.json", import.meta.url);
const CHECK_INTERVAL_MS = 60_000;
/** Low stock: 2 min below the threshold (ignores short dips, a train being loaded for example). */
const LOW_STOCK_AFTER_MS = 2 * 60_000;
/** A low stock alert ends 10% above the threshold, so that small oscillations do not trigger it again. */
const LOW_STOCK_CLEAR_RATIO = 1.1;
/** Deficit: 10 min in a row (a machine waiting a moment for its inputs does not count). */
const DEFICIT_AFTER_MS = 10 * 60_000;

// ---------------------------------------------------------------------------------------------
// Saved rules

let rules: AlertRule[] | undefined;

/** Rules saved before the bot switched to English used "bilan" for deficit alerts. */
function upgrade(rule: AlertRule): AlertRule {
  return (rule.kind as string) === "bilan" ? { ...rule, kind: "deficit" } : rule;
}

async function load(): Promise<AlertRule[]> {
  if (rules) return rules;
  try {
    const parsed: unknown = JSON.parse(await readFile(FILE, "utf8"));
    rules = Array.isArray(parsed) ? (parsed as AlertRule[]).map(upgrade) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    rules = [];
  }
  return rules;
}

/** Written to a temporary file then renamed: a sudden stop never leaves a half-written file. */
async function save(list: AlertRule[]): Promise<void> {
  await mkdir(new URL(".", FILE), { recursive: true });
  const temporary = new URL("alerts.json.tmp", FILE);
  await writeFile(temporary, `${JSON.stringify(list, null, 2)}\n`);
  await rename(temporary, FILE);
  rules = list;
}

export async function listRules(): Promise<AlertRule[]> {
  return [...(await load())].sort((a, b) => a.id - b.id);
}

/** Creates the rule, or updates its threshold if the same alert already exists for this item. */
export async function upsertRule(
  kind: AlertKind,
  item: Item,
  threshold: number | undefined,
  author: string,
): Promise<{ rule: AlertRule; updated: boolean }> {
  const list = [...(await load())];
  const existing = list.find((r) => r.kind === kind && r.className === item.className);
  if (existing) {
    const rule = { ...existing, threshold, name: item.name };
    await save(list.map((r) => (r.id === rule.id ? rule : r)));
    return { rule, updated: true };
  }
  const rule: AlertRule = {
    id: Math.max(0, ...list.map((r) => r.id)) + 1,
    kind,
    className: item.className,
    name: item.name,
    threshold,
    createdBy: author,
    createdAt: new Date().toISOString(),
  };
  await save([...list, rule]);
  return { rule, updated: false };
}

export async function removeRule(id: number): Promise<AlertRule | undefined> {
  const list = await load();
  const rule = list.find((r) => r.id === id);
  if (rule) await save(list.filter((r) => r.id !== id));
  return rule;
}

// ---------------------------------------------------------------------------------------------
// Texts

/** "Low stock · Iron Plate < 1,000", "Deficit · Iron Ingot". */
export function ruleText(rule: AlertRule): string {
  return rule.kind === "stock"
    ? `Low stock · ${rule.name} < ${formatInteger(rule.threshold ?? 0)}`
    : `Deficit · ${rule.name}`;
}

/** Current state of the watched item, in one line. */
export function currentText(rule: AlertRule, report: ItemReport): string {
  return rule.kind === "stock" ? `${amountText(report, report.total)} in stock` : ratesText(report);
}

function eventTexts(rule: AlertRule, report: ItemReport, event: IncidentEvent): { discord: string; game: string } {
  const threshold = formatInteger(rule.threshold ?? 0);
  const stock = amountText(report, report.total);
  const rates = capitalize(ratesText(report));
  const name = escapeMarkdown(report.name);
  const id = `(alert #${rule.id})`;

  if (rule.kind === "stock" && event.kind === "start") {
    return {
      discord: `📉 **Low stock: ${name}**: ${stock}, threshold ${threshold} ${id}\n${rates}`,
      game: `Low stock: ${report.name}, ${stock} (threshold ${threshold}). ${rates}`,
    };
  }
  if (rule.kind === "stock") {
    return {
      discord: `✅ **${name}**: stock back to ${stock}, threshold ${threshold} ${id}`,
      game: `${report.name}: stock back to ${stock} (threshold ${threshold}).`,
    };
  }
  const duration = formatDuration(event.elapsedMs / 60_000);
  if (event.kind === "start") {
    return {
      discord: `📉 **Deficit: ${name}** for ${duration} ${id}\n${rates}. Stock: ${stock}.`,
      game: `Deficit: ${report.name} for ${duration}. ${rates}. Stock: ${stock}.`,
    };
  }
  return {
    discord: `✅ **${name}**: deficit over ${id}\n${rates}`,
    game: `${report.name}: deficit over. ${rates}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Checking

/**
 * `say` sends a message (Discord and game). `check` runs one check; `now` is only passed by tests.
 */
export function createAlertWatcher(say: (texts: { discord: string; game: string }) => Promise<void>) {
  const incidents = new Map<number, Incident>();

  async function check(now = Date.now()): Promise<void> {
    const current = await listRules();
    for (const id of incidents.keys()) if (!current.some((r) => r.id === id)) incidents.delete(id);
    if (current.length === 0) return;

    let inventory;
    try {
      inventory = await loadInventory();
    } catch {
      return; // FRM down: the server monitoring already reports it
    }

    for (const rule of current) {
      const report = reportFor(inventory, rule);
      let incident = incidents.get(rule.id);
      if (!incident) {
        incident = new Incident(rule.kind === "stock" ? LOW_STOCK_AFTER_MS : DEFICIT_AFTER_MS);
        incidents.set(rule.id, incident);
      }
      const threshold = rule.threshold ?? 0;
      const failing =
        rule.kind === "stock"
          ? report.total < (incident.reported ? threshold * LOW_STOCK_CLEAR_RATIO : threshold)
          : report.balance < -BALANCED;
      const event = incident.update(failing, now);
      if (event) await say(eventTexts(rule, report, event));
    }
  }

  return { check };
}

export async function startAlertWatcher(client: Client<true>): Promise<void> {
  if (!config.alertChannelId) {
    console.log("Custom alerts disabled (ALERT_CHANNEL_ID missing from .env).");
    return;
  }
  const channel = await client.channels.fetch(config.alertChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`ALERT_CHANNEL_ID (${config.alertChannelId}) is not a text channel the bot can access`);
  }

  const watcher = createAlertWatcher(async ({ discord, game }) => {
    console.log(`Custom alert: ${game}`);
    await channel.send({ content: discord, allowedMentions: { parse: [] } });
    await botSays([game]).catch((error) =>
      console.warn("Custom alert: cannot send to the game chat:", error instanceof Error ? error.message : error),
    );
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await watcher.check();
    } catch (error) {
      console.error("Custom alerts: check failed:", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  const count = (await listRules()).length;
  console.log(`Custom alerts active (${count} saved).`);
}
