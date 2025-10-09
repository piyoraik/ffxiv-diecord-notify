import { config as loadEnv } from 'dotenv';

loadEnv();

/**
 * 環境変数キーとデフォルト値を 1 か所に集約し、変更しやすくする。
 * ここを書き換えるだけで、アプリ全体の既定値を変更できます。
 */
export const ENV = {
  DISCORD_TOKEN: 'DISCORD_TOKEN',
  DISCORD_CLIENT_ID: 'DISCORD_CLIENT_ID',
  DISCORD_GUILD_ID: 'DISCORD_GUILD_ID',
  DISCORD_CHANNEL_ID: 'DISCORD_CHANNEL_ID',
  LOKI_BASE_URL: 'LOKI_BASE_URL',
  LOKI_QUERY: 'LOKI_QUERY',
  LOKI_QUERY_FILTER: 'LOKI_QUERY_FILTER',
  LOKI_QUERY_LIMIT: 'LOKI_QUERY_LIMIT',
  LOKI_CHUNK_HARD_LIMIT: 'LOKI_CHUNK_HARD_LIMIT',
  LOKI_DEBUG: 'LOKI_DEBUG',
  APP_TIME_ZONE: 'APP_TIME_ZONE',
  AGGREGATION_START_HOUR_JST: 'AGGREGATION_START_HOUR_JST',
  AGGREGATION_END_HOUR_JST: 'AGGREGATION_END_HOUR_JST'
} as const;

export const DEFAULTS = {
  LOKI_BASE_URL: 'http://loki.monitoring.svc.cluster.local:3100',
  LOKI_QUERY: '{content="ffxiv", instance="DESKTOP-LHEGLIC", job="ffxiv-dungeon"}',
  LOKI_QUERY_LIMIT: 5000,
  LOKI_CHUNK_HARD_LIMIT: 5000,
  LOKI_DEBUG: false,
  APP_TIME_ZONE: 'Asia/Tokyo',
  AGGREGATION_START_HOUR_JST: 10,
  AGGREGATION_END_HOUR_JST: 10
} as const;

/** 指定キーの環境変数を取得（未設定は undefined） */
const envOf = (key: keyof typeof ENV): string | undefined => process.env[ENV[key]];

/**
 * 必須環境変数を取得し、未設定なら即座にエラーを投げる。
 * @param key 環境変数名
 * @returns 取得した文字列値
 * @throws 未設定の場合に Error
 */
const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

/**
 * 正の整数をパースし、失敗時はフォールバックを返す。
 * @param value 文字列値
 * @param fallback パース失敗時の代替値（> 0 を想定）
 */
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 0 以上の整数をパースし、失敗時はフォールバックを返す。
 * @param value 文字列値
 * @param fallback パース失敗時の代替値（>= 0 を想定）
 */
const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * 数値を指定範囲に収める。
 * @param value 値
 * @param min 下限
 * @param max 上限
 */
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * Discord 関連設定（遅延評価）。
 * - `token`: Bot トークン
 * - `clientId`: アプリケーション ID
 * - `guildId`: コマンド登録対象ギルド ID
 */
export const discordConfig = {
  token: () => requiredEnv(ENV.DISCORD_TOKEN),
  clientId: () => requiredEnv(ENV.DISCORD_CLIENT_ID),
  guildId: () => requiredEnv(ENV.DISCORD_GUILD_ID)
};

/**
 * Loki 接続設定。
 * - `baseUrl`: Loki のベース URL
 * - `query`: ベースの LogQL
 * - `filter`: 追加フィルタ（`|` から始まれば生結合、それ以外は正規表現マッチ）
 * - `limit`: 1 回の取得上限
 */
export const lokiConfig = {
  baseUrl: () => envOf('LOKI_BASE_URL') ?? DEFAULTS.LOKI_BASE_URL,
  query: () => envOf('LOKI_QUERY') ?? DEFAULTS.LOKI_QUERY,
  filter: () => envOf('LOKI_QUERY_FILTER')?.trim() || undefined,
  limit: (): number => {
    return parsePositiveInt(envOf('LOKI_QUERY_LIMIT'), DEFAULTS.LOKI_QUERY_LIMIT);
  }
};

/**
 * 通知関連設定。
 * - `channelId`: 送信先チャンネル ID
 */
export const notificationConfig = {
  channelId: () => requiredEnv(ENV.DISCORD_CHANNEL_ID)
};

/**
 * アプリ一般設定。
 * - `timeZone`: タイムゾーン
 * - `aggregationStartHourJst`: 集計開始時刻（JST 時）
 * - `lokiChunkHardLimit`: Loki 取得のハード上限
 * - `lokiDebugEnabled`: Loki デバッグ出力有無
 */
export const appSettings = {
  timeZone: (): string => envOf('APP_TIME_ZONE')?.trim() || DEFAULTS.APP_TIME_ZONE,
  aggregationStartHourJst: (): number =>
    clamp(parseNonNegativeInt(envOf('AGGREGATION_START_HOUR_JST'), DEFAULTS.AGGREGATION_START_HOUR_JST), 0, 23),
  aggregationEndHourJst: (): number =>
    clamp(parseNonNegativeInt(envOf('AGGREGATION_END_HOUR_JST'), DEFAULTS.AGGREGATION_END_HOUR_JST), 0, 23),
  lokiChunkHardLimit: (): number => parsePositiveInt(envOf('LOKI_CHUNK_HARD_LIMIT'), DEFAULTS.LOKI_CHUNK_HARD_LIMIT),
  lokiDebugEnabled: (): boolean => envOf('LOKI_DEBUG') === 'true'
};

/**
 * すべての設定値をスナップショットとして取得する（読み取り専用）。
 * 設定の確認やログ出力用途に便利です。
 */
export const resolvedConfig = Object.freeze({
  discord: {
    token: '<hidden>',
    clientId: '<hidden>',
    guildId: '<hidden>'
  },
  notification: {
    channelId: '<hidden>'
  },
  loki: {
    baseUrl: lokiConfig.baseUrl(),
    query: lokiConfig.query(),
    filter: lokiConfig.filter(),
    limit: lokiConfig.limit()
  },
  app: {
    timeZone: appSettings.timeZone(),
    aggregationStartHourJst: appSettings.aggregationStartHourJst(),
    aggregationEndHourJst: appSettings.aggregationEndHourJst(),
    lokiChunkHardLimit: appSettings.lokiChunkHardLimit(),
    lokiDebugEnabled: appSettings.lokiDebugEnabled()
  }
});
