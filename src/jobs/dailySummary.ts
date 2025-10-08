import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { discordConfig, notificationConfig } from '../config.js';
import { formatSummaryMessage, summarizeLogsByDate } from '../logParser.js';

const run = async (): Promise<void> => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  const token = discordConfig.token();
  const channelId = notificationConfig.channelId();

  try {
    await client.login(token);
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== 0) {
      throw new Error(`Channel ${channelId} not found or not a text channel.`);
    }

    const targetDate = getPreviousDateJst();
    const { summary, availableDates } = await summarizeLogsByDate(targetDate);
    if (!summary || summary.entries.length === 0) {
      await (channel as TextChannel).send(`📅 ${targetDate} の攻略記録は見つかりませんでした。`);
      return;
    }

    const message = formatSummaryMessage(summary, availableDates);
    await (channel as TextChannel).send(message);
  } finally {
    await client.destroy();
  }
};

const getPreviousDateJst = (): string => {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jstNow.setUTCHours(0, 0, 0, 0);
  const previous = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000);
  const year = previous.getUTCFullYear();
  const month = String(previous.getUTCMonth() + 1).padStart(2, '0');
  const day = String(previous.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

void run().catch(error => {
  console.error('Failed to send daily summary', error);
  process.exit(1);
});
