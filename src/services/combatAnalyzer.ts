import { queryLogsInRange, type RawLokiEntry } from '../loki/client.js';
import { DailyCombatSummary, CombatSegmentSummary, PlayerStats, ActivityStatus } from '../types/combat.js';

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const startRegex = /「(.+?)」の攻略を開始した。/;
const endRegex = /「(.+?)」の攻略を終了した。/;

interface SegmentWork {
  id: string;
  content: string;
  startNs: bigint | null;
  endNs: bigint | null;
  start: Date | null;
  end: Date | null;
  status: ActivityStatus;
  players: PlayerStats[];
  durationMs: number | null;
  ordinal: number;
  globalIndex: number;
}

interface DamageEvent {
  timestampNs: bigint;
  timestamp: Date;
  actor: string | null;
  target: string | null;
  amount: number;
  isCritical: boolean;
  isDirect: boolean;
}

export const fetchDailyCombat = async (requestedDate?: string): Promise<DailyCombatSummary> => {
  const { targetDate, startDate, endDate } = determineTimeWindow(requestedDate);
  const entries = await queryLogsInRange(startDate, endDate);
  entries.sort((a, b) => BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1);

  const players = collectPlayerNames(entries);
  const segments = buildSegments(entries);
  const damageEvents = extractDamageEvents(entries);

  attachDamageToSegments(segments, damageEvents, players);
  assignOrdinals(segments);

  const summaries: CombatSegmentSummary[] = segments.map(seg => ({
    id: seg.id,
    globalIndex: seg.globalIndex,
    ordinal: seg.ordinal,
    content: seg.content,
    start: seg.start,
    end: seg.end,
    status: seg.status,
    durationMs: seg.durationMs,
    players: seg.players
  }));

  return {
    date: targetDate,
    segments: summaries,
    availableDates: [targetDate]
  };
};

const determineTimeWindow = (
  requestedDate?: string
): { targetDate: string; startDate: Date; endDate: Date } => {
  const targetDate = requestedDate ? sanitizeDate(requestedDate) : computePreviousDateInJst();
  const { year, month, day } = splitDate(targetDate);
  const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const endUtcMs = startUtcMs + DAY_IN_MS;
  return {
    targetDate,
    startDate: new Date(startUtcMs),
    endDate: new Date(endUtcMs)
  };
};

const sanitizeDate = (input: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  }
  return input;
};

const computePreviousDateInJst = (): string => {
  const now = new Date();
  const today = dateKeyFormatter.format(now);
  const { year, month, day } = splitDate(today);
  const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const previous = new Date(startUtcMs - DAY_IN_MS + JST_OFFSET_MS);
  return dateKeyFormatter.format(previous);
};

const splitDate = (value: string): { year: number; month: number; day: number } => {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m, day: d };
};

const collectPlayerNames = (entries: RawLokiEntry[]): Set<string> => {
  const names = new Set<string>();
  for (const entry of entries) {
    const parts = entry.normalized.split('|');
    if (parts[0] === '21') {
      const sourceId = parts[2];
      const sourceName = parts[3];
      const targetId = parts[6];
      const targetName = parts[7];
      if (isPlayerId(sourceId) && sourceName) {
        names.add(sourceName);
      }
      if (isPlayerId(targetId) && targetName) {
        names.add(targetName);
      }
    }
  }
  return names;
};

const buildSegments = (entries: RawLokiEntry[]): SegmentWork[] => {
  const segments: SegmentWork[] = [];
  const openByContent = new Map<string, SegmentWork[]>();

  for (const entry of entries) {
    const parts = entry.normalized.split('|');
    if (parts[0] !== '00' || parts.length < 5) {
      continue;
    }
    const message = parts[4];
    const startMatch = startRegex.exec(message);
    if (startMatch) {
      const content = startMatch[1];
      const segment: SegmentWork = {
        id: `${entry.timestampNs}-${content}`,
        content,
        startNs: BigInt(entry.timestampNs),
        endNs: null,
        start: entry.timestamp,
        end: null,
        status: 'missing_end',
        players: [],
        durationMs: null,
        ordinal: 0,
        globalIndex: 0
      };
      const queue = openByContent.get(content) ?? [];
      queue.push(segment);
      openByContent.set(content, queue);
      segments.push(segment);
      continue;
    }

    const endMatch = endRegex.exec(message);
    if (endMatch) {
      const content = endMatch[1];
      const queue = openByContent.get(content);
      if (queue && queue.length > 0) {
        const segment = queue.shift()!;
        segment.endNs = BigInt(entry.timestampNs);
        segment.end = entry.timestamp;
        segment.status = segment.startNs ? 'completed' : 'missing_start';
      } else {
        const segment: SegmentWork = {
          id: `end-${entry.timestampNs}-${content}`,
          content,
          startNs: null,
          endNs: BigInt(entry.timestampNs),
          start: null,
          end: entry.timestamp,
          status: 'missing_start',
          players: [],
          durationMs: null,
          ordinal: 0,
          globalIndex: 0
        };
        segments.push(segment);
      }
    }
  }

  for (const queue of openByContent.values()) {
    while (queue.length > 0) {
      const segment = queue.shift()!;
      if (!segment.end) {
        segment.status = 'missing_end';
      }
    }
  }

  segments.sort((a, b) => {
    const aNs = a.startNs ?? a.endNs ?? 0n;
    const bNs = b.startNs ?? b.endNs ?? 0n;
    if (aNs < bNs) return -1;
    if (aNs > bNs) return 1;
    return 0;
  });

  return segments;
};

const extractDamageEvents = (entries: RawLokiEntry[]): DamageEvent[] => {
  const events: DamageEvent[] = [];
  for (const entry of entries) {
    const parts = entry.normalized.split('|');
    if (parts[0] !== '00' || parts.length < 5) {
      continue;
    }
    const message = parts[4];
    const parsed = parseDamageMessage(message);
    if (!parsed) {
      continue;
    }
    events.push({
      timestampNs: BigInt(entry.timestampNs),
      timestamp: entry.timestamp,
      ...parsed
    });
  }
  return events;
};

const attachDamageToSegments = (
  segments: SegmentWork[],
  damageEvents: DamageEvent[],
  playerNames: Set<string>
): void => {
  segments.forEach((segment, index) => {
    segment.globalIndex = index + 1;
    if (!segment.startNs || !segment.endNs) {
      segment.players = [];
      segment.durationMs = null;
      return;
    }

    const durationMs = Number((segment.endNs - segment.startNs) / 1_000_000n);
    segment.durationMs = durationMs;

    const durationSeconds = Math.max(durationMs / 1000, 1);
    const contributions = new Map<string, MutablePlayerStats>();

    for (const event of damageEvents) {
      if (event.timestampNs < segment.startNs || event.timestampNs > segment.endNs) {
        continue;
      }
      if (!event.actor || !playerNames.has(event.actor)) {
        continue;
      }
      const stats = contributions.get(event.actor) ?? {
        name: event.actor,
        totalDamage: 0,
        hits: 0,
        criticalHits: 0,
        directHits: 0
      };
      stats.totalDamage += event.amount;
      stats.hits += 1;
      if (event.isCritical) {
        stats.criticalHits += 1;
      }
      if (event.isDirect) {
        stats.directHits += 1;
      }
      contributions.set(event.actor, stats);
    }

    const players: PlayerStats[] = Array.from(contributions.values())
      .map(stats => ({
        name: stats.name,
        totalDamage: stats.totalDamage,
        hits: stats.hits,
        criticalHits: stats.criticalHits,
        directHits: stats.directHits,
        dps: Number((stats.totalDamage / durationSeconds).toFixed(2))
      }))
      .sort((a, b) => b.totalDamage - a.totalDamage);

    segment.players = players;
  });
};

const assignOrdinals = (segments: SegmentWork[]): void => {
  const counters = new Map<string, number>();
  segments.forEach(segment => {
    const count = (counters.get(segment.content) ?? 0) + 1;
    counters.set(segment.content, count);
    segment.ordinal = count;
  });
};

const parseDamageMessage = (
  message: string
): { actor: string | null; target: string | null; amount: number; isCritical: boolean; isDirect: boolean } | null => {
  const cleaned = message
    .replace(/\uE0BF/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const amountMatch = cleaned.match(/(?<amount>\d+)(?:\([^)]*\))?ダメージ。$/);
  if (!amountMatch?.groups) {
    return null;
  }
  const amount = Number.parseInt(amountMatch.groups.amount, 10);
  const isCritical = cleaned.includes('クリティカル');
  const isDirect = cleaned.includes('ダイレクトヒット');

  const actorPattern = /^(?<actor>.+?)の攻撃(?: [^に]*)?\s*(?:クリティカル＆ダイレクトヒット！|クリティカル！|ダイレクトヒット！)?\s*(?<target>.+?)に\d+(?:\([^)]*\))?ダメージ。$/;
  const directPattern = /^(?:クリティカル＆ダイレクトヒット！|クリティカル！|ダイレクトヒット！)\s*(?<target>.+?)に\d+(?:\([^)]*\))?ダメージ。$/;

  const actorMatch = actorPattern.exec(cleaned);
  if (actorMatch?.groups) {
    const actor = actorMatch.groups.actor.trim();
    const target = cleanupTarget(actorMatch.groups.target);
    return { actor, target, amount, isCritical, isDirect };
  }

  const directMatch = directPattern.exec(cleaned);
  if (directMatch?.groups) {
    const target = cleanupTarget(directMatch.groups.target);
    return { actor: null, target, amount, isCritical, isDirect };
  }

  const simplePattern = /^(?<target>.+?)に\d+(?:\([^)]*\))?ダメージ。$/;
  const simpleMatch = simplePattern.exec(cleaned);
  if (simpleMatch?.groups) {
    const target = cleanupTarget(simpleMatch.groups.target);
    return { actor: null, target, amount, isCritical, isDirect };
  }

  return null;
};

const cleanupTarget = (value: string): string =>
  value
    .replace(/は受け流した！/, '')
    .replace(/はブロックした！/, '')
    .trim();

const isPlayerId = (id?: string): boolean => typeof id === 'string' && id.startsWith('10');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type MutablePlayerStats = {
  name: string;
  totalDamage: number;
  hits: number;
  criticalHits: number;
  directHits: number;
};
