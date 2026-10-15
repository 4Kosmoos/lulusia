// Reads and checks the environment variables (see .env.example).

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable: ${name} (see .env.example)`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function seconds(name: string, fallback: number, minimum: number): number {
  const value = Number(optional(name) ?? fallback);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a number greater than or equal to ${minimum}`);
  }
  return value * 1000;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  statusChannelId: required("STATUS_CHANNEL_ID"),
  frmUrl: required("FRM_URL").replace(/\/+$/, ""),
  frmToken: optional("FRM_TOKEN"),
  statusIntervalMs: seconds("STATUS_INTERVAL_SECONDS", 60, 15),
  /** Channel bridged with the game chat. Without it, the bridge is disabled. */
  chatChannelId: optional("CHAT_CHANNEL_ID"),
  chatPollMs: seconds("CHAT_POLL_SECONDS", 3, 1),
  /** Channel for monitoring alerts (server, RAM, disk) and custom alerts. Without it, both are disabled. */
  alertChannelId: optional("ALERT_CHANNEL_ID"),
  /** Healthchecks.io ping URL (heartbeat). Secret: it can be used to send fake signals. */
  healthcheckUrl: optional("HEALTHCHECK_URL"),
};
