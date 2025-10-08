import type { RawLokiEntry } from '../loki/client.js';

export type ParsedEvent = StartEvent | EndEvent | DamageEvent | AbilityEvent | UnknownEvent;

export interface BaseEvent {
  entry: RawLokiEntry;
  timestampNs: bigint;
  timestamp: Date;
}

export interface StartEvent extends BaseEvent {
  type: 'start';
  content: string;
}

export interface EndEvent extends BaseEvent {
  type: 'end';
  content: string;
}

export interface DamageEvent extends BaseEvent {
  type: 'damage';
  actor: string | null;
  target: string | null;
  amount: number;
  isCritical: boolean;
  isDirect: boolean;
  source: 'message';
}

export interface AbilityEvent extends BaseEvent {
  type: 'ability';
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  abilityId: string;
  abilityName: string;
}

export interface UnknownEvent extends BaseEvent {
  type: 'unknown';
}

const startRegex = /「(.+?)」の攻略を開始した。/;
const endRegex = /「(.+?)」の攻略を終了した。/;

export const parseEvents = (entries: RawLokiEntry[]): ParsedEvent[] => {
  const events: ParsedEvent[] = [];
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed) {
      continue;
    }
    if (Array.isArray(parsed)) {
      events.push(...parsed);
    } else {
      events.push(parsed);
    }
  }
  return events;
};

const parseEntry = (entry: RawLokiEntry): ParsedEvent | ParsedEvent[] | null => {
  const { normalized, stream } = entry;
  const parts = normalized.split('|');
  const type = parts[0];
  switch (type) {
    case '00':
      return parseSystemEvent(entry, parts);
    case '21':
    case '22':
      return parseStructuredAbility(entry, parts, stream);
    default:
      return {
        type: 'unknown',
        entry,
        timestampNs: BigInt(entry.timestampNs),
        timestamp: entry.timestamp
      } satisfies UnknownEvent;
  }
};

const parseSystemEvent = (entry: RawLokiEntry, parts: string[]): ParsedEvent | null => {
  if (parts.length < 5) {
    return null;
  }
  const message = parts[4];
  const startMatch = startRegex.exec(message);
  if (startMatch) {
    return {
      type: 'start',
      content: startMatch[1],
      entry,
      timestampNs: BigInt(entry.timestampNs),
      timestamp: entry.timestamp
    } satisfies StartEvent;
  }
  const endMatch = endRegex.exec(message);
  if (endMatch) {
    return {
      type: 'end',
      content: endMatch[1],
      entry,
      timestampNs: BigInt(entry.timestampNs),
      timestamp: entry.timestamp
    } satisfies EndEvent;
  }

  const damage = parseDamageMessage(message);
  if (damage) {
    return {
      type: 'damage',
      source: 'message',
      entry,
      timestampNs: BigInt(entry.timestampNs),
      timestamp: entry.timestamp,
      ...damage
    } satisfies DamageEvent;
  }

  return null;
};

const parseStructuredAbility = (
  entry: RawLokiEntry,
  parts: string[],
  stream: Record<string, string>
): ParsedEvent | null => {
  if (stream?.type === 'ability' || stream?.type === 'aoe') {
    const actor = stream.actor ?? parts[3] ?? null;
    const target = stream.target ?? parts[7] ?? null;
    const amountStr = stream.amount ?? parts[33];
    const amount = amountStr ? Number.parseInt(amountStr, 10) : NaN;
    if (!Number.isNaN(amount) && actor) {
      return {
        type: 'damage',
        source: 'message',
        entry,
        timestampNs: BigInt(entry.timestampNs),
        timestamp: entry.timestamp,
        actor,
        target,
        amount,
        isCritical: stream.isCritical?.toLowerCase?.() === 'true',
        isDirect: stream.isDirect?.toLowerCase?.() === 'true'
      } satisfies DamageEvent;
    }
  }

  if (parts.length < 8) {
    return null;
  }
  const sourceId = stream.sourceID ?? parts[2] ?? '';
  const sourceName = stream.sourceName ?? parts[3] ?? '';
  const abilityId = stream.abilityID ?? parts[4] ?? '';
  const abilityName = stream.abilityName ?? parts[5] ?? '';
  const targetId = stream.targetID ?? parts[6] ?? '';
  const targetName = stream.targetName ?? parts[7] ?? '';
  return {
    type: 'ability',
    entry,
    timestampNs: BigInt(entry.timestampNs),
    timestamp: entry.timestamp,
    sourceId,
    sourceName,
    targetId,
    targetName,
    abilityId,
    abilityName
  } satisfies AbilityEvent;
};

export const parseDamageMessage = (
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

export const isStartEvent = (event: ParsedEvent): event is StartEvent => event.type === 'start';
export const isEndEvent = (event: ParsedEvent): event is EndEvent => event.type === 'end';
export const isDamageEvent = (event: ParsedEvent): event is DamageEvent => event.type === 'damage';
export const isAbilityEvent = (event: ParsedEvent): event is AbilityEvent => event.type === 'ability';
