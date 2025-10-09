import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { discordConfig, notificationConfig } from '../config.js';
import { formatSummaryMessage, summarizeLogsByDate } from '../logParser.js';
import { listRoster } from '../db/roster.js';
import { replaceJobTagsWithEmojis } from '../emoji.js';
import { chunkMessage } from '../utils/text.js';

/**
 * 依存関係を受け取り、日次サマリ投稿を実行する（テスト/実行兼用）。
 */
export const runDailySummaryWithClient = async (
  client: Client,
  token: string,
  channelId: string,
  summarize = summarizeLogsByDate,
  format = formatSummaryMessage
): Promise<void> => {
  try {
    await client.login(token);
    const channel = await client.channels.fetch(channelId);
    if (!channel || (channel as any).type !== 0) {
      throw new Error(`Channel ${channelId} not found or not a text channel.`);
    }

    const targetDate = getPreviousDateJst();
    const { summary, availableDates } = await summarize(targetDate);
    if (!summary || summary.entries.length === 0) {
      await (channel as unknown as TextChannel).send(`📅 ${targetDate} の攻略記録は見つかりませんでした。`);
      return;
    }

    const guild = (channel as TextChannel).guild;
    const roster = await listRoster(guild.id);
    const rosterNames = new Set(roster.map(r => r.name));
    let message = format(summary, availableDates, { rosterNames, guild: guild as any });
    message = replaceJobTagsWithEmojis(message, guild);
    const chunks = chunkMessage(message);
    // 1/N 送信（ジョブは通常メッセージ）
    await (channel as unknown as TextChannel).send(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await (channel as unknown as TextChannel).send(chunks[i]);
    }
  } finally {
    await client.destroy();
  }
};

/** 実行時のエントリポイント（既存動作と互換） */
const run = async (): Promise<void> => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  const token = discordConfig.token();
  const channelId = notificationConfig.channelId();
  await runDailySummaryWithClient(client, token, channelId);
};

/**
 * JST の観点で前日の日付 (YYYY-MM-DD) を返す。
 */
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

import { fileURLToPath } from 'node:url';

// 直接実行時のみ起動（テストや import 時は起動しない）
if (typeof process !== 'undefined') {
  try {
    const isMain = typeof process.argv?.[1] === 'string' && fileURLToPath(import.meta.url) === process.argv[1];
    if (isMain) {
      void run().catch(error => {
        console.error('Failed to send daily summary', error);
        process.exit(1);
      });
    }
  } catch {
    // noop
  }
}
