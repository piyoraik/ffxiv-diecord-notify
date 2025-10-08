import { lokiConfig } from './config.js';

const startRegex = /「(.+?)」の攻略を開始した。/;
const endRegex = /「(.+?)」の攻略を終了した。/;
const debug = (...args: unknown[]): void => {
  if (process.env.LOKI_DEBUG === 'true') {
    console.log('[loki-debug]', ...args);
  }
};
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour12: false,
  hour: '2-digit',
  minute: '2-digit'
});

export type ActivityStatus = 'completed' | 'missing_start' | 'missing_end';

export interface SummaryEntry {
  content: string;
  start: Date | null;
  end: Date | null;
  durationMs: number | null;
  status: ActivityStatus;
}

export interface DailySummary {
  date: string;
  entries: SummaryEntry[];
  issues: string[];
}

interface LogEvent {
  timestamp: Date;
  type: 'start' | 'end';
  content: string;
  rawTimestamp: string;
}

export interface SummaryResult {
  summary: DailySummary | null;
  availableDates: string[];
}

interface LokiStreamResult {
  stream: Record<string, string>;
  values: [string, string][];
}

interface LokiQueryRangeResponse {
  status: string;
  data: {
    resultType: string;
    result: LokiStreamResult[];
  };
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

// Loki から特定日（デフォルトは前日 JST）の攻略ログを取得しサマリ化する
export const summarizeLogsByDate = async (
  requestedDate?: string
): Promise<SummaryResult> => {
  const { targetDate, startDate, endDate } = determineTimeWindow(requestedDate);
  debug('query window', { targetDate, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  const events = await fetchEventsFromLoki(startDate, endDate);

  if (events.length === 0) {
    debug('no events returned for window');
    return {
      summary: {
        date: targetDate,
        entries: [],
        issues: []
      },
      availableDates: [targetDate]
    };
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  debug('event count after sort', events.length);

  const activities = buildActivities(events);
  const grouped = groupByDate(activities);
  const summary = grouped.get(targetDate) ?? {
    date: targetDate,
    entries: [],
    issues: []
  };

  const availableDates = [...grouped.keys()].sort();
  if (!availableDates.includes(targetDate)) {
    availableDates.push(targetDate);
  }

  return {
    summary,
    availableDates: Array.from(new Set(availableDates)).sort()
  };
};

const determineTimeWindow = (
  requestedDate?: string
): { targetDate: string; startDate: Date; endDate: Date } => {
  const targetDate = requestedDate ? sanitizeDate(requestedDate) : computePreviousDateInJst();
  const { year, month, day } = parseTargetDate(targetDate);
  const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const endUtcMs = startUtcMs + DAY_IN_MS;
  return { targetDate, startDate: new Date(startUtcMs), endDate: new Date(endUtcMs) };
};

const sanitizeDate = (input: string): string => {
  if (!datePattern.test(input)) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  }
  return input;
};

const computePreviousDateInJst = (): string => {
  const now = new Date();
  const jstNowMs = now.getTime() + JST_OFFSET_MS;
  const jstDate = new Date(jstNowMs);
  const formatted = dateKeyFormatter.format(jstDate);
  const { year, month, day } = parseTargetDate(formatted);
  const previousUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS - DAY_IN_MS;
  return dateKeyFormatter.format(new Date(previousUtcMs + JST_OFFSET_MS));
};

const parseTargetDate = (input: string): { year: number; month: number; day: number } => {
  const [yearStr, monthStr, dayStr] = input.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date component: ${input}`);
  }
  return { year, month, day };
};

const fetchEventsFromLoki = async (startDate: Date, endDate: Date): Promise<LogEvent[]> => {
  const base = lokiConfig.baseUrl();
  const query = buildLokiQuery();
  const limit = lokiConfig.limit();

  let url: URL;
  try {
    url = new URL('/loki/api/v1/query_range', base);
  } catch (error) {
    throw new Error(`Invalid LOKI_BASE_URL: ${base}`);
  }

  url.searchParams.set('query', query);
  url.searchParams.set('start', toNanoseconds(startDate));
  url.searchParams.set('end', toNanoseconds(endDate));
  url.searchParams.set('direction', 'FORWARD');
  url.searchParams.set('limit', String(limit));

  debug('fetching from loki', url.toString());
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    debug('loki query failed', response.status, response.statusText, body);
    throw new Error(`Loki query failed: ${response.status} ${response.statusText} ${body}`);
  }

  const payload = (await response.json()) as LokiQueryRangeResponse;
  if (payload.status !== 'success' || !payload.data || !Array.isArray(payload.data.result)) {
    debug('unexpected payload', payload);
    throw new Error('Unexpected Loki response structure.');
  }

  const events: LogEvent[] = [];
  let rawLineCount = 0;
  for (const stream of payload.data.result) {
    for (const [timestampNs, line] of stream.values) {
      if (!line) {
        continue;
      }
      rawLineCount += 1;
      let normalized = line;
      if (normalized.startsWith('line=')) {
        normalized = normalized.substring('line='.length);
        if (normalized.startsWith('"') && normalized.endsWith('"')) {
          normalized = normalized.substring(1, normalized.length - 1);
        }
      }
      const parts = normalized.split('|');
      if (parts.length < 5) {
        debug('skip line (insufficient parts)', normalized);
        continue;
      }
      const prefix = parts[0];
      if (prefix !== '00') {
        debug('skip line (unexpected prefix)', prefix);
        continue;
      }
      const message = parts[4];
      const startMatch = startRegex.exec(message);
      const endMatch = endRegex.exec(message);
      if (!startMatch && !endMatch) {
        continue;
      }
      const eventTimestamp = dateFromNanoseconds(timestampNs);
      if (!eventTimestamp) {
        continue;
      }
      if (startMatch) {
        events.push({
          timestamp: eventTimestamp,
          rawTimestamp: timestampNs,
          type: 'start',
          content: startMatch[1]
        });
      } else if (endMatch) {
        events.push({
          timestamp: eventTimestamp,
          rawTimestamp: timestampNs,
          type: 'end',
          content: endMatch[1]
        });
      }
    }
  }
  debug('raw line count', rawLineCount, 'parsed events', events.length);

  return events;
};

const toNanoseconds = (date: Date): string => {
  const millis = date.getTime();
  const nanoseconds = BigInt(millis) * 1_000_000n;
  return nanoseconds.toString();
};

const buildLokiQuery = (): string => {
  const base = lokiConfig.query().trim();
  const filter = lokiConfig.filter()?.trim();
  if (!filter) {
    return base;
  }
  const escaped = filter.replace(/"/g, '\\"');
  return `${base} |~ "${escaped}"`;
};

const dateFromNanoseconds = (value: string): Date | null => {
  try {
    const nanoseconds = BigInt(value);
    const millis = Number(nanoseconds / 1_000_000n);
    return Number.isFinite(millis) ? new Date(millis) : null;
  } catch (error) {
    return null;
  }
};

interface ActivityRecord {
  content: string;
  start: LogEvent | null;
  end: LogEvent | null;
}

const buildActivities = (events: LogEvent[]): ActivityRecord[] => {
  const open = new Map<string, ActivityRecord[]>();
  const records: ActivityRecord[] = [];

  for (const event of events) {
    if (event.type === 'start') {
      const record: ActivityRecord = {
        content: event.content,
        start: event,
        end: null
      };
      records.push(record);
      const queue = open.get(event.content) ?? [];
      queue.push(record);
      open.set(event.content, queue);
      continue;
    }

    const queue = open.get(event.content);
    if (queue && queue.length > 0) {
      const record = queue.shift()!;
      record.end = event;
    } else {
      records.push({
        content: event.content,
        start: null,
        end: event
      });
    }
  }

  return records;
};

const groupByDate = (records: ActivityRecord[]): Map<string, DailySummary> => {
  const grouped = new Map<string, DailySummary>();

  for (const record of records) {
    const reference = record.start?.timestamp ?? record.end?.timestamp;
    if (!reference) {
      continue;
    }
    const dateKey = dateKeyFormatter.format(reference);
    const entry: SummaryEntry = {
      content: record.content,
      start: record.start?.timestamp ?? null,
      end: record.end?.timestamp ?? null,
      durationMs: computeDuration(record.start?.timestamp, record.end?.timestamp),
      status: deriveStatus(record)
    };
    const issues: string[] = [];
    if (entry.status === 'missing_end' && entry.start) {
      issues.push(`終了ログなし: ${entry.content} (開始 ${entry.start.toISOString()})`);
    }
    if (entry.status === 'missing_start' && entry.end) {
      issues.push(`開始ログなし: ${entry.content} (終了 ${entry.end.toISOString()})`);
    }
    const bucket = grouped.get(dateKey) ?? { date: dateKey, entries: [], issues: [] };
    bucket.entries.push(entry);
    bucket.issues.push(...issues);
    grouped.set(dateKey, bucket);
  }

  for (const [, summary] of grouped) {
    summary.entries.sort((a, b) => getComparableTime(a) - getComparableTime(b));
  }

  return grouped;
};

const deriveStatus = (record: ActivityRecord): ActivityStatus => {
  if (record.start && record.end) {
    return 'completed';
  }
  if (record.start && !record.end) {
    return 'missing_end';
  }
  return 'missing_start';
};

const computeDuration = (start: Date | undefined | null, end: Date | undefined | null): number | null => {
  if (!start || !end) {
    return null;
  }
  const diff = end.getTime() - start.getTime();
  return diff >= 0 ? diff : null;
};

const getComparableTime = (entry: SummaryEntry): number => {
  if (entry.start) {
    return entry.start.getTime();
  }
  if (entry.end) {
    return entry.end.getTime();
  }
  return Number.MAX_SAFE_INTEGER;
};

// Discord のエフェメラル返信向けに日次サマリをテキスト化する
export const formatSummaryMessage = (
  summary: DailySummary,
  availableDates: string[]
): string => {
  const lines: string[] = [];
  lines.push(`📅 ${summary.date} の攻略履歴`);
  if (summary.entries.length === 0) {
    lines.push('記録が見つかりませんでした。');
  } else {
    for (const entry of summary.entries) {
      lines.push(renderEntry(entry));
    }
  }
  if (summary.issues.length > 0) {
    lines.push('⚠️ ペアリングに失敗したログがあります:');
    summary.issues.forEach(issue => lines.push(`  - ${issue}`));
  }
  if (availableDates.length > 1) {
    lines.push(`📚 利用可能な日付: ${availableDates.join(', ')}`);
  }
  return lines.join('\n');
};

// 1件分の攻略結果を人間が読みやすい行形式で整形する
const renderEntry = (entry: SummaryEntry): string => {
  const start = entry.start ? timeFormatter.format(entry.start) : '??:??';
  const end = entry.end ? timeFormatter.format(entry.end) : '??:??';
  const duration = entry.durationMs !== null ? formatDuration(entry.durationMs) : '所要時間不明';
  switch (entry.status) {
    case 'completed':
      return `- ${start}〜${end} 「${entry.content}」 ${duration}`;
    case 'missing_end':
      return `- ${start}〜??:?? 「${entry.content}」 (終了ログなし)`;
    case 'missing_start':
    default:
      return `- ??:??〜${end} 「${entry.content}」 (開始ログなし)`;
  }
};

// ミリ秒差分を「X時間Y分Z秒」の文字列に変換する
const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const chunks: string[] = [];
  if (hours > 0) {
    chunks.push(`${hours}時間`);
  }
  if (minutes > 0 || hours > 0) {
    chunks.push(`${minutes}分`);
  }
  chunks.push(`${seconds}秒`);
  return chunks.join('');
};
