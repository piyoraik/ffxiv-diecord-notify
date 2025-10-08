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

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

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
  filter: () => process.env.LOKI_QUERY_FILTER?.trim() || undefined,
  limit: (): number => {
    return parsePositiveInt(process.env.LOKI_QUERY_LIMIT, 5000);
  }
};

export const notificationConfig = {
  channelId: () => requiredEnv('DISCORD_CHANNEL_ID')
};

export const appSettings = {
  timeZone: (): string => process.env.APP_TIME_ZONE?.trim() || 'Asia/Tokyo',
  aggregationStartHourJst: (): number => clamp(parseNonNegativeInt(process.env.AGGREGATION_START_HOUR_JST, 10), 0, 23),
  lokiChunkHardLimit: (): number => parsePositiveInt(process.env.LOKI_CHUNK_HARD_LIMIT, 5000),
  lokiDebugEnabled: (): boolean => process.env.LOKI_DEBUG === 'true'
};
