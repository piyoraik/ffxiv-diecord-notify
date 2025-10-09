import { lokiConfig, appSettings } from '../config.js';

/**
 * Loki から読み出した生ログエントリの表現。
 * - timestampNs: Loki が返すナノ秒の文字列タイムスタンプ
 * - timestamp: timestampNs を JS Date に変換したもの
 * - normalized: 行頭の `line=` などを取り除いた実データ文字列
 * - stream: Loki のラベルセット（ストリーム識別用）
 */
export interface RawLokiEntry {
  timestampNs: string;
  timestamp: Date;
  normalized: string;
  stream: Record<string, string>;
}

/**
 * Loki の query_range レスポンスに含まれるストリーム要素の最小型。
 * values は `[timestamp(ns), line]` のタプル配列。
 */
interface LokiStreamPayload {
  stream?: Record<string, string>;
  values?: [string, string][];
}

const NS_IN_MS = 1_000_000n;
const chunkHardLimit = appSettings.lokiChunkHardLimit();
const enableDebugLogging = appSettings.lokiDebugEnabled();

/**
 * Date を Loki のナノ秒表現に変換する。
 * @param value 変換対象の日時
 * @returns ナノ秒（bigint）
 */
const toNanoseconds = (value: Date): bigint => BigInt(value.getTime()) * NS_IN_MS;

/**
 * Loki のナノ秒文字列を JavaScript の Date に変換する。
 * @param ns ナノ秒の文字列表現（例: "1728380689123456789"）
 * @returns 変換後の Date
 */
const parseTimestamp = (ns: string): Date => {
  const millis = Number(BigInt(ns) / NS_IN_MS);
  return new Date(millis);
};

/**
 * Loki の line 値から余計な装飾（line= や両端の引用符）を除去する。
 * @param input 元の文字列
 * @returns 正規化後の文字列
 */
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

/**
 * 1 回の query_range で取得する件数上限を決める。
 * @param configuredLimit 設定からの希望値
 * @param hardLimit システム側の上限制約
 * @returns 1 以上 hardLimit 以下に丸めた最終値
 */
const computeChunkLimit = (configuredLimit: number, hardLimit: number): number =>
  Math.max(1, Math.min(configuredLimit, hardLimit));

/**
 * Loki の query_range API へのベース URL を作成する。
 * @param baseUrl LOKI_BASE_URL（例: https://loki.example.com）
 * @returns query_range までを含む URL オブジェクト
 * @throws baseUrl が不正な場合に Error
 */
const createQueryRangeBaseUrl = (baseUrl: string): URL => {
  try {
    return new URL('/loki/api/v1/query_range', baseUrl);
  } catch {
    throw new Error(`Invalid LOKI_BASE_URL: ${baseUrl}`);
  }
};

/**
 * query_range へのリクエスト URL を組み立てる。
 * @param baseUrl createQueryRangeBaseUrl() の戻り値
 * @param query LogQL（フィルタを含めた最終的なクエリ）
 * @param startNs 取得開始のナノ秒
 * @param endNs 取得終了のナノ秒
 * @param limit 取得上限
 * @returns 完成した URL
 */
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

/**
 * Loki に HTTP リクエストを送り、ストリーム配列を取得する。
 * @param url query_range への完全な URL
 * @returns Loki のストリーム配列（空配列を含み得る）
 * @throws HTTP エラー時に Error
 */
const fetchLokiStreams = async (url: URL): Promise<LokiStreamPayload[]> => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text();
    logDebug('loki error', response.status, response.statusText, body);
    throw new Error(`Loki query failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as any;
  return (payload?.data?.result ?? []) as LokiStreamPayload[];
};

/**
 * ストリーム配列から新規エントリを抽出し、
 * 重複排除セット（seen）と出力配列（entries）を更新する。
 * @param streams Loki のストリーム配列
 * @param seen 既に取り込んだキーの集合（重複排除用）
 * @param entries 出力先の配列（追記される）
 * @param lowerBoundNs 取り込む最小タイムスタンプ（ナノ秒）
 * @returns 取り込んだ件数と、最後に見つかった最大タイムスタンプ
 */
const collectEntriesFromStreams = (
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

/**
 * 指定期間の Loki ログを FORWARD 方向でページングしながら取得する。
 * 取得結果はタイムスタンプ昇順に整列して返す。
 * @param start 取得開始日時（含む）
 * @param end 取得終了日時（含む）
 * @returns 正規化済みエントリ配列（昇順）
 */
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
    logDebug('fetching chunk', requestUrl.toString());
    const streams = await fetchLokiStreams(requestUrl);
    const { count, lastTimestamp } = collectEntriesFromStreams(streams, seen, entries, currentStartNs);

    if (count === 0 || !lastTimestamp) {
      break;
    }

    if (count < chunkLimit) {
      break;
    }

    currentStartNs = lastTimestamp + 1n;
  }

  entries.sort(compareByTimestampAsc);
  return entries;
};

/**
 * ベースの LogQL と任意のフィルタを結合し、最終的なクエリ文字列を作る。
 * - フィルタが `|` で始まる場合はそのまま結合
 * - それ以外は正規表現マッチ（|~）としてエスケープして結合
 * @returns 結合後の LogQL
 */
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

/**
 * デバッグログ出力（設定により抑制）。
 * @param args console.log に渡す引数
 */
const logDebug = (...args: unknown[]): void => {
  if (enableDebugLogging) {
    console.log('[loki-debug]', ...args);
  }
};

/**
 * RawLokiEntry をタイムスタンプ昇順で比較するための比較関数。
 * @param a 比較対象 A
 * @param b 比較対象 B
 * @returns a < b: -1, a > b: 1, 等しい: 0
 */
const compareByTimestampAsc = (a: RawLokiEntry, b: RawLokiEntry): number => {
  const aNs = BigInt(a.timestampNs);
  const bNs = BigInt(b.timestampNs);
  if (aNs < bNs) return -1;
  if (aNs > bNs) return 1;
  return 0;
};
