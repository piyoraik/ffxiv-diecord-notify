import { lokiConfig, appSettings } from '../config.js';

export interface RawLokiEntry {
  timestampNs: string;
  timestamp: Date;
  normalized: string;
  stream: Record<string, string>;
}

interface LokiStreamPayload {
  stream?: Record<string, string>;
  values?: [string, string][];
}

const NS_IN_MS = 1_000_000n;
const chunkHardLimit = appSettings.lokiChunkHardLimit();
const enableDebugLogging = appSettings.lokiDebugEnabled();

// 日時をLoki向けのナノ秒表現へ変換する。
const toNanoseconds = (value: Date): bigint => BigInt(value.getTime()) * NS_IN_MS;

// ナノ秒文字列をJavaScriptのDateに戻す。
const parseTimestamp = (ns: string): Date => {
  const millis = Number(BigInt(ns) / NS_IN_MS);
  return new Date(millis);
};

// Lokiのレスポンスから実データ部分を抽出して整形する。
const normalizeLine = (input: string): string => {
  let line = input;
  if (line.startsWith('line=')) {
    line = line.substring(5);
  }
  if (line.startsWith('"') && line.endsWith('"')) {
    line = line.substring(1, line.length - 1);
  }
  if (line.startsWith('line=')) {
    line = line.substring(5);
  }
  return line;
};

// 設定値をもとに1回のRange Queryで取得する件数上限を決める。
const computeChunkLimit = (configuredLimit: number, hardLimit: number): number =>
  Math.max(1, Math.min(configuredLimit, hardLimit));

// Lokiのquery_rangeエンドポイントを示すベースURLを生成する。
const createQueryRangeBaseUrl = (baseUrl: string): URL => {
  try {
    return new URL('/loki/api/v1/query_range', baseUrl);
  } catch {
    throw new Error(`Invalid LOKI_BASE_URL: ${baseUrl}`);
  }
};

// クエリパラメータを含めたリクエストURLを組み立てる。
const buildRequestUrl = (
  baseUrl: URL,
  query: string,
  startNs: bigint,
  endNs: bigint,
  limit: number
): URL => {
  const url = new URL(baseUrl.toString());
  url.searchParams.set('query', query);
  url.searchParams.set('start', startNs.toString());
  url.searchParams.set('end', endNs.toString());
  url.searchParams.set('direction', 'FORWARD');
  url.searchParams.set('limit', String(limit));
  return url;
};

// LokiへHTTPリクエストを発行し、ストリームデータを取得する。
const fetchLokiStreams = async (url: URL): Promise<LokiStreamPayload[]> => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text();
    debug('loki error', response.status, response.statusText, body);
    throw new Error(`Loki query failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as any;
  return (payload?.data?.result ?? []) as LokiStreamPayload[];
};

// 取得したストリームからエントリを抽出し、重複排除のセットを更新する。
const processChunkResult = (
  streams: LokiStreamPayload[],
  seen: Set<string>,
  entries: RawLokiEntry[],
  lowerBoundNs: bigint
): { count: number; lastTimestamp: bigint | null } => {
  let count = 0;
  let lastTimestamp: bigint | null = null;

  for (const stream of streams) {
    const streamLabels = stream.stream ?? {};
    const values = stream.values ?? [];
    const streamKeyPrefix = JSON.stringify(streamLabels);

    for (const [timestampNs, rawLine] of values) {
      const nsBig = BigInt(timestampNs);
      if (nsBig < lowerBoundNs) {
        continue;
      }

      const normalized = normalizeLine(rawLine);
      const key = `${streamKeyPrefix}|${timestampNs}|${normalized}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push({
        timestampNs,
        timestamp: parseTimestamp(timestampNs),
        normalized,
        stream: streamLabels
      });
      count += 1;

      if (!lastTimestamp || nsBig > lastTimestamp) {
        lastTimestamp = nsBig;
      }
    }
  }

  return { count, lastTimestamp };
};

// Lokiから指定期間のログを取得し、タイムスタンプ順に返却する。
export const queryLogsInRange = async (start: Date, end: Date): Promise<RawLokiEntry[]> => {
  const baseUrl = lokiConfig.baseUrl();
  const query = buildQuery();
  const chunkLimit = computeChunkLimit(lokiConfig.limit(), chunkHardLimit);
  const baseRequestUrl = createQueryRangeBaseUrl(baseUrl);

  const startNsInitial = toNanoseconds(start);
  const endNs = toNanoseconds(end);
  let currentStartNs = startNsInitial;

  const seen = new Set<string>();
  const entries: RawLokiEntry[] = [];

  while (currentStartNs <= endNs) {
    const requestUrl = buildRequestUrl(baseRequestUrl, query, currentStartNs, endNs, chunkLimit);
    debug('fetching chunk', requestUrl.toString());
    const streams = await fetchLokiStreams(requestUrl);
    const { count, lastTimestamp } = processChunkResult(streams, seen, entries, currentStartNs);

    if (count === 0 || !lastTimestamp) {
      break;
    }

    if (count < chunkLimit) {
      break;
    }

    currentStartNs = lastTimestamp + 1n;
  }

  entries.sort((a, b) => (BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1));
  return entries;
};

// Lokiクエリと任意のフィルタを結合した文字列を返す。
const buildQuery = (): string => {
  const base = lokiConfig.query().trim();
  const filter = lokiConfig.filter();
  if (!filter) {
    return base;
  }
  const trimmed = filter.trim();
  if (trimmed.startsWith('|')) {
    return `${base} ${trimmed}`;
  }
  const escaped = trimmed.replace(/"/g, '\\"');
  return `${base} |~ "${escaped}"`;
};

// デバッグログの出力制御を行う。
const debug = (...args: unknown[]): void => {
  if (enableDebugLogging) {
    console.log('[loki-debug]', ...args);
  }
};
