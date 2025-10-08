import { lokiConfig } from '../config.js';

export interface RawLokiEntry {
  timestampNs: string;
  timestamp: Date;
  normalized: string;
}

const toNanoseconds = (value: Date): string => (BigInt(value.getTime()) * 1_000_000n).toString();

const parseTimestamp = (ns: string): Date => {
  const millis = Number(BigInt(ns) / 1_000_000n);
  return new Date(millis);
};

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

export const queryLogsInRange = async (start: Date, end: Date): Promise<RawLokiEntry[]> => {
  const baseUrl = lokiConfig.baseUrl();
  const query = buildQuery();
  const limit = lokiConfig.limit();

  let url: URL;
  try {
    url = new URL('/loki/api/v1/query_range', baseUrl);
  } catch (error) {
    throw new Error(`Invalid LOKI_BASE_URL: ${baseUrl}`);
  }

  url.searchParams.set('query', query);
  url.searchParams.set('start', toNanoseconds(start));
  url.searchParams.set('end', toNanoseconds(end));
  url.searchParams.set('direction', 'FORWARD');
  url.searchParams.set('limit', String(limit));

  debug('fetching', url.toString());
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text();
    debug('loki error', response.status, response.statusText, body);
    throw new Error(`Loki query failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as any;
  if (!payload?.data?.result) {
    return [];
  }

  const entries: RawLokiEntry[] = [];
  for (const stream of payload.data.result) {
    const values = stream.values as [string, string][];
    for (const [timestampNs, rawLine] of values) {
      entries.push({
        timestampNs,
        timestamp: parseTimestamp(timestampNs),
        normalized: normalizeLine(rawLine)
      });
    }
  }

  return entries;
};

const buildQuery = (): string => {
  const base = lokiConfig.query().trim();
  const filter = lokiConfig.filter()?.trim();
  if (!filter) {
    return base;
  }
  const escaped = filter.replace(/"/g, '\\"');
  return `${base} |~ "${escaped}"`;
};

const debug = (...args: unknown[]): void => {
  if (process.env.LOKI_DEBUG === 'true') {
    console.log('[loki-debug]', ...args);
  }
};
