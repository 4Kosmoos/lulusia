// #statut message: a single bot message, edited at every update.

import { ChannelType, EmbedBuilder, type Client, type Message } from "discord.js";
import { plural } from "@lulusia/lib/format";
import type { Player, PowerCircuit, SessionInfo } from "@lulusia/lib/frm";
import { batteryText, powerLines } from "./circuits.ts";
import { config } from "./config.ts";
import { frm } from "./frm.ts";

const COLORS = {
  running: 0x2ecc71,
  paused: 0xf1c40f,
  problem: 0xe67e22,
  down: 0xe74c3c,
};

let statusMessage: Message | undefined;
let lastSuccess: Date | undefined;

function formatPlayTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function playersField(players: Player[]): string {
  const online = players.filter((p) => p.Online).map((p) => p.Name || "Unnamed pioneer");
  return online.length > 0 ? online.join("\n") : "Nobody";
}

function powerField(circuits: PowerCircuit[]): string {
  if (circuits.length === 0) return "No power circuit";
  const lines = powerLines(circuits);
  const tripped = circuits.filter((c) => c.FuseTriggered).length;
  if (tripped > 0) lines.push(`⚠️ **Fuse blown** on ${plural(tripped, "circuit")}!`);
  return lines.join("\n");
}

function sessionField(session: SessionInfo): string {
  const clock = `${String(session.Hours).padStart(2, "0")}:${String(session.Minutes).padStart(2, "0")}`;
  return [
    `Day ${session.PassedDays}, ${clock} ${session.IsDay ? "☀️" : "🌙"}`,
    `Play time: ${formatPlayTime(session.TotalPlayDuration)}`,
  ].join("\n");
}

async function buildEmbed(): Promise<EmbedBuilder> {
  const embed = new EmbedBuilder()
    .setTitle("🏭 Lulusia")
    .setFooter({ text: `Updated every ${config.statusIntervalMs / 1000} s` })
    .setTimestamp(new Date());

  try {
    const [session, players, power] = await Promise.all([frm.sessionInfo(), frm.players(), frm.power()]);
    lastSuccess = new Date();
    const fuseTripped = power.some((c) => c.FuseTriggered);
    const online = players.filter((p) => p.Online).length;

    let state = "🟢 Online, game running";
    let color = COLORS.running;
    if (session.IsPaused) {
      state = "⏸️ Online, paused (nobody connected)";
      color = COLORS.paused;
    }
    if (fuseTripped) color = COLORS.problem;

    return embed
      .setColor(color)
      .setDescription(state)
      .addFields(
        { name: `👷 Players (${online})`, value: playersField(players), inline: true },
        { name: "📅 Game", value: sessionField(session), inline: true },
        { name: "⚡ Power consumption", value: powerField(power) },
        { name: "🔋 Batteries", value: batteryText(power) ?? "None" },
      );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const since = lastSuccess
      ? `Last answer <t:${Math.floor(lastSuccess.getTime() / 1000)}:R>.`
      : "No answer since the bot started.";
    return embed
      .setColor(COLORS.down)
      .setDescription(`🔴 Server or FRM unreachable\n${since}\n\`${reason}\``);
  }
}

async function findOrCreateMessage(client: Client<true>, embed: EmbedBuilder): Promise<Message> {
  const channel = await client.channels.fetch(config.statusChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`STATUS_CHANNEL_ID (${config.statusChannelId}) is not a text channel the bot can access`);
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
      // Message deleted by hand or no longer accessible: look for it again or create a new one.
      statusMessage = undefined;
    }
  }
  statusMessage = await findOrCreateMessage(client, embed);
}
