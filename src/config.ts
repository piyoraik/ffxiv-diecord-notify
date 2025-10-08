import { config as loadEnv } from 'dotenv';

loadEnv();

// 必須環境変数を取得し未設定なら即座にエラーを投げる
const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

// Discord 関連設定を遅延評価の関数にまとめる
export const discordConfig = {
  token: () => requiredEnv('DISCORD_TOKEN'),
  clientId: () => requiredEnv('DISCORD_CLIENT_ID'),
  guildId: () => requiredEnv('DISCORD_GUILD_ID')
};

// Loki への接続設定を環境変数から取得する
export const lokiConfig = {
  baseUrl: () => process.env.LOKI_BASE_URL ?? 'http://loki.monitoring.svc.cluster.local:3100',
  query: () => process.env.LOKI_QUERY ?? '{content="ffxiv", instance="DESKTOP-LHEGLIC", job="ffxiv-dungeon"}',
  filter: () => process.env.LOKI_QUERY_FILTER ?? '攻略を(開始|終了)した。',
  limit: (): number => {
    const raw = process.env.LOKI_QUERY_LIMIT;
    const parsed = raw ? Number.parseInt(raw, 10) : 5000;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
  }
};

export const notificationConfig = {
  channelId: () => requiredEnv('DISCORD_CHANNEL_ID')
};
