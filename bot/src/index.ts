// Entry point of the Lulusia bot.

import { Client, Events, GatewayIntentBits } from "discord.js";
import { startAlertWatcher } from "./alerts.ts";
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
    GatewayIntentBits.MessageContent, // privileged intent, enabled in the Developer Portal
  ],
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in to Discord as ${readyClient.user.tag}`);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await updateStatus(readyClient);
    } catch (error) {
      console.error("Cannot update the status message:", error);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, config.statusIntervalMs);

  try {
    await startChatBridge(readyClient);
  } catch (error) {
    console.error("Cannot start the chat bridge:", error);
  }

  try {
    await registerCommands(readyClient);
  } catch (error) {
    console.error("Cannot register the commands:", error);
  }

  try {
    await startMonitoring(readyClient);
  } catch (error) {
    console.error("Cannot start monitoring:", error);
  }

  try {
    await startAlertWatcher(readyClient);
  } catch (error) {
    console.error("Cannot start custom alerts:", error);
  }

  startHeartbeat();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, stopping the bot.`);
    await client.destroy();
    process.exit(0);
  });
}

await client.login(config.discordToken);
