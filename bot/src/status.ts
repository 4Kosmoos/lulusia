// Message de #statut : un seul message du bot, modifié à chaque mise à jour.

import { ChannelType, EmbedBuilder, type Client, type Message } from "discord.js";
import { config } from "./config.ts";
import { frm, type Player, type PowerCircuit, type SessionInfo } from "./frm.ts";

const COLORS = {
  running: 0x2ecc71,
  paused: 0xf1c40f,
  problem: 0xe67e22,
  down: 0xe74c3c,
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const mw = (value: number) => `${number.format(value)} MW`;

let statusMessage: Message | undefined;
let lastSuccess: Date | undefined;

function formatPlayTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

function playersField(players: Player[]): string {
  const online = players.filter((p) => p.Online).map((p) => p.Name || "Pionnier sans nom");
  return online.length > 0 ? online.join("\n") : "Personne";
}

function powerField(circuits: PowerCircuit[]): string {
  if (circuits.length === 0) return "Aucun réseau électrique";
  // Comme le panneau électrique du jeu : la production réelle suit la consommation.
  // (Le champ PowerProduction de FRM ne compte que la production de base, souvent 0 avec Refined Power.)
  const sum = (key: "PowerConsumed" | "PowerCapacity" | "PowerMaxConsumed") =>
    circuits.reduce((total, c) => total + c[key], 0);
  const consumed = sum("PowerConsumed");
  const capacity = sum("PowerCapacity");
  const maxConsumed = sum("PowerMaxConsumed");
  const usage = capacity > 0 ? ` (${number.format((consumed / capacity) * 100)} % de la capacité)` : "";
  const lines = [
    `Consommation : **${mw(consumed)}**${usage}`,
    `Capacité : ${mw(capacity)}`,
    `Consommation max possible : ${mw(maxConsumed)}`,
  ];
  const margin = capacity - maxConsumed;
  if (margin < 0) {
    lines.push(`🔴 Si tout tourne à fond, il manque **${mw(-margin)}** : risque de fusible grillé.`);
  } else if (capacity > 0 && margin < capacity * 0.05) {
    lines.push(`⚠️ Marge faible : ${mw(margin)} entre la consommation max et la capacité.`);
  }
  const tripped = circuits.filter((c) => c.FuseTriggered).length;
  if (tripped > 0) lines.push(`⚠️ **Fusible grillé** sur ${tripped} réseau${tripped > 1 ? "x" : ""} !`);
  return lines.join("\n");
}

function batteryField(circuits: PowerCircuit[]): string {
  const withBatteries = circuits.filter((c) => c.BatteryCapacity > 0);
  if (withBatteries.length === 0) return "Aucune";
  const capacity = withBatteries.reduce((total, c) => total + c.BatteryCapacity, 0);
  const percent = withBatteries.reduce((total, c) => total + c.BatteryPercent * c.BatteryCapacity, 0) / capacity;
  const differential = withBatteries.reduce((total, c) => total + c.BatteryDifferential, 0);
  let trend = "stables";
  if (differential < -0.01) {
    const main = withBatteries.reduce((a, b) => (b.BatteryCapacity > a.BatteryCapacity ? b : a));
    trend = `se vident (vides dans ${main.BatteryTimeEmpty})`;
  } else if (differential > 0.01) {
    trend = "se rechargent";
  }
  return `${number.format(percent)} %, ${trend}`;
}

function sessionField(session: SessionInfo): string {
  const clock = `${String(session.Hours).padStart(2, "0")}:${String(session.Minutes).padStart(2, "0")}`;
  return [
    `Jour ${session.PassedDays}, ${clock} ${session.IsDay ? "☀️" : "🌙"}`,
    `Temps de jeu : ${formatPlayTime(session.TotalPlayDuration)}`,
  ].join("\n");
}

async function buildEmbed(): Promise<EmbedBuilder> {
  const embed = new EmbedBuilder()
    .setTitle("🏭 Lulusia")
    .setFooter({ text: `Mis à jour toutes les ${config.statusIntervalMs / 1000} s` })
    .setTimestamp(new Date());

  try {
    const [session, players, power] = await Promise.all([frm.sessionInfo(), frm.players(), frm.power()]);
    lastSuccess = new Date();
    const fuseTripped = power.some((c) => c.FuseTriggered);
    const online = players.filter((p) => p.Online).length;

    let state = "🟢 En ligne, partie en cours";
    let color = COLORS.running;
    if (session.IsPaused) {
      state = "⏸️ En ligne, en pause (personne n'est connecté)";
      color = COLORS.paused;
    }
    if (fuseTripped) color = COLORS.problem;

    return embed
      .setColor(color)
      .setDescription(state)
      .addFields(
        { name: `👷 Joueurs (${online})`, value: playersField(players), inline: true },
        { name: "📅 Partie", value: sessionField(session), inline: true },
        { name: "⚡ Énergie", value: powerField(power) },
        { name: "🔋 Batteries", value: batteryField(power) },
      );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const since = lastSuccess
      ? `Dernière réponse <t:${Math.floor(lastSuccess.getTime() / 1000)}:R>.`
      : "Aucune réponse depuis le démarrage du bot.";
    return embed
      .setColor(COLORS.down)
      .setDescription(`🔴 Serveur ou FRM injoignable\n${since}\n\`${reason}\``);
  }
}

async function findOrCreateMessage(client: Client<true>, embed: EmbedBuilder): Promise<Message> {
  const channel = await client.channels.fetch(config.statusChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`STATUS_CHANNEL_ID (${config.statusChannelId}) n'est pas un salon textuel accessible au bot`);
  }
  const recent = await channel.messages.fetch({ limit: 20 });
  const existing = recent.find((m) => m.author.id === client.user.id);
  if (existing) return existing.edit({ embeds: [embed] });
  return channel.send({ embeds: [embed] });
}

export async function updateStatus(client: Client<true>): Promise<void> {
  const embed = await buildEmbed();
  if (statusMessage) {
    try {
      statusMessage = await statusMessage.edit({ embeds: [embed] });
      return;
    } catch {
      // Message supprimé à la main ou inaccessible : on le recherche ou on en recrée un.
      statusMessage = undefined;
    }
  }
  statusMessage = await findOrCreateMessage(client, embed);
}
