// Alertes perso : « préviens quand le stock d'Iron Plate passe sous 1 000 », « …quand Iron Ingot est
// consommé plus vite que produit ». Les règles se créent avec /alerte (Discord) ou !alerte (jeu) et sont
// enregistrées dans data/alerts.json (un volume Docker en production). Vérifiées chaque minute, elles
// préviennent dans #alertes et dans le chat du jeu, au début du problème puis à sa fin.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ChannelType, escapeMarkdown, type Client } from "discord.js";
import { BALANCED, amountText, loadInventory, ratesText, reportFor, type Item, type ItemReport } from "./commands/inventory.ts";
import { config } from "./config.ts";
import { capitalize, formatDuration, formatInteger } from "./format.ts";
import { botSays } from "./game-chat.ts";
import { Incident, type IncidentEvent } from "./monitor.ts";

export type AlertKind = "stock" | "bilan";

export interface AlertRule {
  /** Numéro affiché et utilisé pour supprimer l'alerte. */
  id: number;
  kind: AlertKind;
  className: string;
  /** Nom de l'objet au moment de la création. */
  name: string;
  /** Pour « stock » : alerte quand le stock passe sous ce seuil. */
  threshold?: number;
  createdBy: string;
  createdAt: string;
}

const FILE = new URL("../data/alerts.json", import.meta.url);
const CHECK_INTERVAL_MS = 60_000;
/** Stock bas : 2 min sous le seuil (évite les creux passagers, un train qui se charge par exemple). */
const LOW_STOCK_AFTER_MS = 2 * 60_000;
/** Fin d'alerte « stock bas » à 10 % au-dessus du seuil, pour ne pas recevoir d'alerte à chaque oscillation. */
const LOW_STOCK_CLEAR_RATIO = 1.1;
/** Bilan négatif : 10 min de suite (une machine qui attend un instant ses ingrédients ne compte pas). */
const DEFICIT_AFTER_MS = 10 * 60_000;

// ---------------------------------------------------------------------------------------------
// Enregistrement des règles

let rules: AlertRule[] | undefined;

async function load(): Promise<AlertRule[]> {
  if (rules) return rules;
  try {
    const parsed: unknown = JSON.parse(await readFile(FILE, "utf8"));
    rules = Array.isArray(parsed) ? (parsed as AlertRule[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    rules = [];
  }
  return rules;
}

/** Écriture dans un fichier temporaire puis renommage : un arrêt brutal ne laisse pas un fichier à moitié écrit. */
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

/** Crée la règle, ou met à jour son seuil si la même alerte existe déjà pour cet objet. */
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
// Textes

/** « Stock bas · Iron Plate < 1 000 », « Bilan négatif · Iron Ingot ». */
export function ruleText(rule: AlertRule): string {
  return rule.kind === "stock"
    ? `Stock bas · ${rule.name} < ${formatInteger(rule.threshold ?? 0)}`
    : `Bilan négatif · ${rule.name}`;
}

/** État actuel de l'objet surveillé, en une ligne. */
export function currentText(rule: AlertRule, report: ItemReport): string {
  return rule.kind === "stock" ? `${amountText(report, report.total)} en stock` : ratesText(report);
}

function eventTexts(rule: AlertRule, report: ItemReport, event: IncidentEvent): { discord: string; game: string } {
  const threshold = formatInteger(rule.threshold ?? 0);
  const stock = amountText(report, report.total);
  const rates = capitalize(ratesText(report));
  const name = escapeMarkdown(report.name);
  const id = `(alerte n°${rule.id})`;

  if (rule.kind === "stock" && event.kind === "start") {
    return {
      discord: `📉 **Stock bas : ${name}** : ${stock}, seuil ${threshold} ${id}\n${rates}`,
      game: `Stock bas : ${report.name}, ${stock} (seuil ${threshold}). ${rates}`,
    };
  }
  if (rule.kind === "stock") {
    return {
      discord: `✅ **${name}** : stock revenu à ${stock}, seuil ${threshold} ${id}`,
      game: `${report.name} : stock revenu à ${stock} (seuil ${threshold}).`,
    };
  }
  const minutes = formatDuration(event.elapsedMs / 60_000);
  if (event.kind === "start") {
    return {
      discord: `📉 **Bilan négatif : ${name}** depuis ${minutes} ${id}\n${rates}. Stock : ${stock}.`,
      game: `Bilan négatif : ${report.name} depuis ${minutes}. ${rates}. Stock : ${stock}.`,
    };
  }
  return {
    discord: `✅ **${name}** : bilan rétabli ${id}\n${rates}`,
    game: `${report.name} : bilan rétabli. ${rates}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Vérification

/**
 * `say` envoie un message (Discord et jeu). `check` fait une vérification ; `now` n'est passé que par les tests.
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
      return; // FRM en panne : la surveillance du serveur s'en charge déjà
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
    console.log("Alertes perso désactivées (ALERT_CHANNEL_ID absent du .env).");
    return;
  }
  const channel = await client.channels.fetch(config.alertChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`ALERT_CHANNEL_ID (${config.alertChannelId}) n'est pas un salon textuel accessible au bot`);
  }

  const watcher = createAlertWatcher(async ({ discord, game }) => {
    console.log(`Alerte perso : ${game}`);
    await channel.send({ content: discord, allowedMentions: { parse: [] } });
    await botSays([game]).catch((error) =>
      console.warn("Alerte perso : envoi dans le chat du jeu impossible :", error instanceof Error ? error.message : error),
    );
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await watcher.check();
    } catch (error) {
      console.error("Alertes perso : vérification impossible :", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`Alertes perso actives (${(await listRules()).length} enregistrée(s)).`);
}
