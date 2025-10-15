import { queryLogsInRange } from '../loki/client.js';
import { appSettings } from '../config.js';
import {
  parseEvents,
  isStartEvent,
  isEndEvent,
  isDamageEvent,
  isAbilityEvent,
  isAddCombatantEvent,
  isRemoveCombatantEvent,
  isAttributeAddEvent,
  type DamageEvent as ParsedDamageEvent,
  type AbilityEvent as ParsedAbilityEvent,
  type AddCombatantEvent,
  type RemoveCombatantEvent,
  type ExtendedParsedEvent
} from '../parsers/events.js';
import { jobCodeForId, roleForJobCode } from '../jobs.js';
import { abilityJobMap } from '../data/abilityJobMap.js';
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
  participants: string[];
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
const AGGREGATION_END_HOUR_JST = appSettings.aggregationEndHourJst();
const AGGREGATION_START_OFFSET_MS = AGGREGATION_START_HOUR_JST * HOUR_IN_MS;
// 00 の開始が短時間に重複出力されるケースを抑制するためのデバウンス（ns）
const START_DEBOUNCE_NS = 120n * 1_000_000_000n; // 120 秒

export const analyzeLogsBetween = async (startDate: Date, endDate: Date): Promise<CombatSegmentSummary[]> => {
  const entries = await queryLogsInRange(startDate, endDate);
  entries.sort((a, b) => (BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1));

  const parsedEvents = parseEvents(entries);
  const damageEvents = parsedEvents.filter(isDamageEvent) as ParsedDamageEvent[];
  const abilityEvents = parsedEvents.filter(isAbilityEvent) as ParsedAbilityEvent[];
  const addEvents = parsedEvents.filter(isAddCombatantEvent) as AddCombatantEvent[];
  const removeEvents = parsedEvents.filter(isRemoveCombatantEvent) as RemoveCombatantEvent[];
  const attrAddEvents = parsedEvents.filter(isAttributeAddEvent);
  const { idToJobCode, nameToJobCode, idToName } = buildPlayerRegistry(addEvents, attrAddEvents);
  const playerNames = collectPlayerNames(abilityEvents, damageEvents, addEvents);
  const segments = buildSegments(parsedEvents);

  assignParticipants(segments, addEvents, removeEvents);
  const abilityJobsBySegment = inferJobsFromAbilities(segments, abilityEvents, idToJobCode, nameToJobCode, idToName);
  attachDamageToSegments(segments, damageEvents, playerNames, nameToJobCode, abilityJobsBySegment);
  assignOrdinals(segments);

  return segments.map(seg => ({
    id: seg.id,
    globalIndex: seg.globalIndex,
    ordinal: seg.ordinal,
    content: seg.content,
    start: seg.start,
    end: seg.end,
    status: seg.status,
    durationMs: seg.durationMs,
    players: seg.players,
    participants: seg.participants
  }));
};

/**
 * 指定日の攻略ログを取得・解析し、日次の戦闘サマリへ変換する。
 * @param requestedDate YYYY-MM-DD 文字列（省略時は前日）
 */
export const fetchDailyCombat = async (requestedDate?: string): Promise<DailyCombatSummary> => {
  const { targetDate, startDate, endDate } = determineTimeWindow(requestedDate);
  const segments = await analyzeLogsBetween(startDate, endDate);

  return {
    date: targetDate,
    segments,
    availableDates: [targetDate]
  };
};

/**
 * 集計対象の UTC 時刻範囲と日付表示用の文字列を決定する。
 */
export const determineTimeWindow = (
  requestedDate?: string
): { targetDate: string; startDate: Date; endDate: Date } => {
  const targetDate = requestedDate ? sanitizeDate(requestedDate) : computePreviousDateInJst();
  const { year, month, day } = splitDate(targetDate);
  const dayBaseUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const startUtcMs = dayBaseUtcMs + AGGREGATION_START_OFFSET_MS;
  const endBaseUtcMs = dayBaseUtcMs + AGGREGATION_END_HOUR_JST * HOUR_IN_MS;
  const endUtcMs = endBaseUtcMs + (AGGREGATION_END_HOUR_JST <= AGGREGATION_START_HOUR_JST ? DAY_IN_MS : 0);
  return {
    targetDate,
    startDate: new Date(startUtcMs),
    endDate: new Date(endUtcMs)
  };
};

/**
 * YYYY-MM-DD 形式を軽くバリデーションする。
 */
const sanitizeDate = (input: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  }
  return input;
};

/**
 * 現在時刻から JST 前日の日付を求める。
 */
const computePreviousDateInJst = (): string => {
  const now = new Date();
  const today = dateKeyFormatter.format(now);
  const { year, month, day } = splitDate(today);
  const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const previous = new Date(startUtcMs - DAY_IN_MS + JST_OFFSET_MS);
  return dateKeyFormatter.format(previous);
};

/**
 * YYYY-MM-DD を {year, month, day} に分解する。
 */
const splitDate = (value: string): { year: number; month: number; day: number } => {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m, day: d };
};

/**
 * アビリティ/ダメージイベントからプレイヤー名集合を抽出する。
 */
const collectPlayerNames = (
  abilityEvents: ParsedAbilityEvent[],
  damageEvents: ParsedDamageEvent[],
  addEvents: AddCombatantEvent[] = []
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
  addEvents.forEach(event => {
    if (isPlayerId(event.combatantId) && event.combatantName) {
      names.add(event.combatantName);
    }
  });
  return names;
};

/**
 * 03/04 の入退場情報から、各セグメントの参加推定を行う。
 * - セグメント終了時点までに Add されているプレイヤーを候補に含める
 * - セグメント開始前に Remove されているプレイヤーは除外
 * - ID→名前の解決は直近の Add 名を優先
 */
const assignParticipants = (
  segments: SegmentWork[],
  addEvents: AddCombatantEvent[],
  removeEvents: RemoveCombatantEvent[]
): void => {
  const idToName = new Map<string, string>();
  const idToJobCode = new Map<string, string | undefined>();
  addEvents.forEach(a => {
    if (a.combatantId && a.combatantName) {
      idToName.set(a.combatantId, a.combatantName);
    }
  });

  segments.forEach(seg => {
    const set = new Set<string>();
    const segEnd = seg.endNs ?? seg.startNs ?? null;
    const segStart = seg.startNs ?? seg.endNs ?? null;
    if (!segEnd || !segStart) {
      seg.participants = [];
      return;
    }

    for (const a of addEvents) {
      if (a.timestampNs <= segEnd) {
        const name = idToName.get(a.combatantId) ?? a.combatantName;
        if (name) set.add(name);
      }
    }
    for (const r of removeEvents) {
      if (r.timestampNs < segStart) {
        const name = idToName.get(r.combatantId) ?? r.combatantName;
        if (name) set.delete(name);
      }
    }
    seg.participants = Array.from(set);
  });
};

const inferJobsFromAbilities = (
  segments: SegmentWork[],
  abilityEvents: ParsedAbilityEvent[],
  idToJobCode: Map<string, string>,
  nameToJobCode: Map<string, string>,
  idToName: Map<string, string>
): Map<string, Map<string, string>> => {
  const jobsBySegment = new Map<string, Map<string, string>>();
  const preparedSegments = segments.filter(segment => segment.startNs && segment.endNs);

  if (preparedSegments.length === 0 || abilityEvents.length === 0) {
    return jobsBySegment;
  }

  for (const segment of preparedSegments) {
    const segJobs = new Map<string, string>();
    const startNs = segment.startNs!;
    const endNs = segment.endNs!;
    for (const event of abilityEvents) {
      if (event.timestampNs < startNs || event.timestampNs > endNs) {
        continue;
      }
      if (!isPlayerId(event.sourceId) || !event.abilityId) {
        continue;
      }
      const abilityId = event.abilityId.toUpperCase();
      const jobCode = abilityJobMap[abilityId];
      if (!jobCode) {
        continue;
      }

      const name = event.sourceName && event.sourceName.length > 0 ? event.sourceName : idToName.get(event.sourceId);
      if (!name) {
        continue;
      }

      segJobs.set(name, jobCode);
      const currentIdJob = idToJobCode.get(event.sourceId);
      if (currentIdJob !== jobCode) {
        idToJobCode.set(event.sourceId, jobCode);
      }
      const currentNameJob = nameToJobCode.get(name);
      if (currentNameJob !== jobCode) {
        nameToJobCode.set(name, jobCode);
      }
    }
    if (segJobs.size > 0) {
      jobsBySegment.set(segment.id, segJobs);
    }
  }

  return jobsBySegment;
};

/**
 * 03/261 Add からプレイヤーの JobCode を構築する。
 */
const buildPlayerRegistry = (
  addEvents: AddCombatantEvent[],
  attrAddEvents: ReturnType<typeof parseEvents> extends Array<infer T> ? T[] : never
) => {
  const idToJobCode = new Map<string, string>();
  const idToName = new Map<string, string>();
  const nameToJobCode = new Map<string, string>();

  addEvents.forEach(a => {
    if (a.combatantId && a.combatantName) idToName.set(a.combatantId, a.combatantName);
  });

  for (const e of attrAddEvents as any[]) {
    if (e?.type !== 'attrAdd') continue;
    const code = jobCodeForId(e.jobId);
    const name = e.combatantName || idToName.get(e.combatantId);
    if (!code) continue;
    if (e.combatantId) {
      const existingById = idToJobCode.get(e.combatantId);
      if (!existingById) {
        idToJobCode.set(e.combatantId, code);
      }
    }
    if (name) {
      const existingByName = nameToJobCode.get(name);
      if (!existingByName) {
        nameToJobCode.set(name, code);
      }
    }
  }

  return { idToJobCode, nameToJobCode, idToName };
};

/**
 * 開始/終了イベントをペアリングし、攻略セグメントを構築する。
 */
const buildSegments = (events: ExtendedParsedEvent[]): SegmentWork[] => {
  const segments: SegmentWork[] = [];
  const openByContent = new Map<string, SegmentWork[]>();

  for (const event of events) {
    if (isStartEvent(event)) {
      const content = event.content;
      // 直近の未終了開始と近接（<= START_DEBOUNCE_NS）する開始は重複と見なして無視
      {
        const q = openByContent.get(content);
        if (q && q.length > 0) {
          const last = q[q.length - 1];
          if (last.startNs && event.timestampNs - last.startNs <= START_DEBOUNCE_NS) {
            continue;
          }
        }
      }
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
        globalIndex: 0,
        participants: []
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
        // もっとも近い未終了の開始とペアリング（LIFO）
        const segment = queue.pop()!;
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
          globalIndex: 0,
          participants: []
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

/**
 * セグメントごとに与ダメージイベントを集計してプレイヤー別 DPS を算出する。
 */
const attachDamageToSegments = (
  segments: SegmentWork[],
  damageEvents: ParsedDamageEvent[],
  playerNames: Set<string>,
  nameToJobCode: Map<string, string> = new Map(),
  abilityJobsBySegment: Map<string, Map<string, string>> = new Map()
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
      .map(stats => {
        const abilityJobs = abilityJobsBySegment.get(segment.id);
        const abilityJob = abilityJobs?.get(stats.name);
        const jobCode = abilityJob ?? nameToJobCode.get(stats.name);
        const role = roleForJobCode(jobCode);
        return ({
          name: stats.name,
          totalDamage: stats.totalDamage,
          hits: stats.hits,
          criticalHits: stats.criticalHits,
          directHits: stats.directHits,
          dps: Number((stats.totalDamage / durationSeconds).toFixed(2)),
          jobCode,
          role
        });
      })
      .sort((a, b) => b.totalDamage - a.totalDamage);

    segment.players = players;
  });
};

/**
 * コンテンツ名ごとに出現順序（連番）を割り当てる。
 */
const assignOrdinals = (segments: SegmentWork[]): void => {
  const counters = new Map<string, number>();
  segments.forEach(segment => {
    const count = (counters.get(segment.content) ?? 0) + 1;
    counters.set(segment.content, count);
    segment.ordinal = count;
  });
};

/**
 * FFXIV のプレイヤー ID（10 から始まる）かを判定する簡易チェック。
 */
const isPlayerId = (id?: string): boolean => typeof id === 'string' && id.startsWith('10');

/**
 * テスト用に一部の純粋関数を公開する（外部 API としては非推奨）。
 */
export const __testables = {
  determineTimeWindow,
  // 以下はユニットテスト専用の限定公開
  buildSegments,
  assignOrdinals,
  attachDamageToSegments,
  collectPlayerNames,
  assignParticipants
};
