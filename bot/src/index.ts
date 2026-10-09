// Point d'entrée du bot Lulusia.

import { Client, Events, GatewayIntentBits } from "discord.js";
import { startChatBridge } from "./chat.ts";
import { handleInteraction, registerCommands } from "./commands/index.ts";
import { config } from "./config.ts";
import { startHeartbeat } from "./heartbeat.ts";
import { startMonitoring } from "./monitor.ts";
import { updateStatus } from "./status.ts";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // intent privilégié, activé dans le Developer Portal
  ],
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connecté à Discord en tant que ${readyClient.user.tag}`);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await updateStatus(readyClient);
    } catch (error) {
      console.error("Mise à jour de #statut impossible :", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, config.statusIntervalMs);

  try {
    await startChatBridge(readyClient);
  } catch (error) {
    console.error("Pont du chat impossible à démarrer :", error);
  }

  try {
    await registerCommands(readyClient);
  } catch (error) {
    console.error("Enregistrement des commandes impossible :", error);
  }

  try {
    await startMonitoring(readyClient);
  } catch (error) {
    console.error("Surveillance impossible à démarrer :", error);
  }

  startHeartbeat();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`${signal} reçu, arrêt du bot.`);
    await client.destroy();
    process.exit(0);
  });
}

await client.login(config.discordToken);
