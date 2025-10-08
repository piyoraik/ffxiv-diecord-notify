import { queryLogsInRange } from '../loki/client.js';
import { appSettings } from '../config.js';
import {
  parseEvents,
  isStartEvent,
  isEndEvent,
  isDamageEvent,
  isAbilityEvent,
  type DamageEvent as ParsedDamageEvent,
  type AbilityEvent as ParsedAbilityEvent,
  type ParsedEvent
} from '../parsers/events.js';
import { DailyCombatSummary, CombatSegmentSummary, PlayerStats, ActivityStatus } from '../types/combat.js';

const TIME_ZONE = appSettings.timeZone();

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

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

type MutablePlayerStats = {
  name: string;
  totalDamage: number;
  hits: number;
  criticalHits: number;
  directHits: number;
};

const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const JST_OFFSET_MS = 9 * HOUR_IN_MS;
const AGGREGATION_START_HOUR_JST = appSettings.aggregationStartHourJst();
const AGGREGATION_START_OFFSET_MS = AGGREGATION_START_HOUR_JST * HOUR_IN_MS;

export const fetchDailyCombat = async (requestedDate?: string): Promise<DailyCombatSummary> => {
  const { targetDate, startDate, endDate } = determineTimeWindow(requestedDate);
  const entries = await queryLogsInRange(startDate, endDate);
  entries.sort((a, b) => BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1);

  const parsedEvents = parseEvents(entries);
  const damageEvents = parsedEvents.filter(isDamageEvent) as ParsedDamageEvent[];
  const abilityEvents = parsedEvents.filter(isAbilityEvent) as ParsedAbilityEvent[];
  const playerNames = collectPlayerNames(abilityEvents, damageEvents);
  const segments = buildSegments(parsedEvents);

  attachDamageToSegments(segments, damageEvents, playerNames);
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
  const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS + AGGREGATION_START_OFFSET_MS;
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

const collectPlayerNames = (
  abilityEvents: ParsedAbilityEvent[],
  damageEvents: ParsedDamageEvent[]
): Set<string> => {
  const names = new Set<string>();
  abilityEvents.forEach(event => {
    if (isPlayerId(event.sourceId) && event.sourceName) {
      names.add(event.sourceName);
    }
    if (isPlayerId(event.targetId) && event.targetName) {
      names.add(event.targetName);
    }
  });
  damageEvents.forEach(event => {
    if (event.actor) {
      names.add(event.actor);
    }
  });
  return names;
};

const buildSegments = (events: ParsedEvent[]): SegmentWork[] => {
  const segments: SegmentWork[] = [];
  const openByContent = new Map<string, SegmentWork[]>();

  for (const event of events) {
    if (isStartEvent(event)) {
      const content = event.content;
      const segment: SegmentWork = {
        id: `${event.timestampNs}-${content}`,
        content,
        startNs: event.timestampNs,
        endNs: null,
        start: event.timestamp,
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

    if (isEndEvent(event)) {
      const content = event.content;
      const queue = openByContent.get(content);
      if (queue && queue.length > 0) {
        const segment = queue.shift()!;
        segment.endNs = event.timestampNs;
        segment.end = event.timestamp;
        segment.status = segment.startNs ? 'completed' : 'missing_start';
      } else {
        segments.push({
          id: `end-${event.timestampNs}-${content}`,
          content,
          startNs: null,
          endNs: event.timestampNs,
          start: null,
          end: event.timestamp,
          status: 'missing_start',
          players: [],
          durationMs: null,
          ordinal: 0,
          globalIndex: 0
        });
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

const attachDamageToSegments = (
  segments: SegmentWork[],
  damageEvents: ParsedDamageEvent[],
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
      if (!event.actor) {
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

const isPlayerId = (id?: string): boolean => typeof id === 'string' && id.startsWith('10');
