// Lecture et vérification des variables d'environnement (voir .env.example).

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
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
    throw new Error(`${name} doit être un nombre supérieur ou égal à ${minimum}`);
  }
  return value * 1000;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  statusChannelId: required("STATUS_CHANNEL_ID"),
  frmUrl: required("FRM_URL").replace(/\/+$/, ""),
  frmToken: optional("FRM_TOKEN"),
  statusIntervalMs: seconds("STATUS_INTERVAL_SECONDS", 60, 15),
  /** Salon du pont avec le chat du jeu. Sans lui, le pont est désactivé. */
  chatChannelId: optional("CHAT_CHANNEL_ID"),
  chatPollMs: seconds("CHAT_POLL_SECONDS", 3, 1),
  /** Salon des alertes de surveillance (serveur, RAM, disque). Sans lui, la surveillance est désactivée. */
  alertChannelId: optional("ALERT_CHANNEL_ID"),
};
