import type { RawLokiEntry } from '../loki/client.js';

/**
 * パースされたイベントの共用型。
 */
export type ParsedEvent = StartEvent | EndEvent | DamageEvent | AbilityEvent | UnknownEvent;

/** AddCombatant（type=03）イベント。cactbot LogGuide に準拠。 */
export interface AddCombatantEvent extends BaseEvent {
  type: 'addCombatant';
  combatantId: string; // 例: プレイヤーは 10 から始まる ID
  combatantName: string;
}

/** RemoveCombatant（type=04）イベント。cactbot LogGuide に準拠。 */
export interface RemoveCombatantEvent extends BaseEvent {
  type: 'removeCombatant';
  combatantId: string;
  combatantName: string;
}

/** 主要イベントに Add/RemoveCombatant を加えた拡張型（互換のため別名）。 */
export type ExtendedParsedEvent =
  | ParsedEvent
  | AddCombatantEvent
  | RemoveCombatantEvent
  | AttributeAddEvent;

/** 261 Add（属性列挙）イベント。Name/Job などの属性を保持。 */
export interface AttributeAddEvent extends BaseEvent {
  type: 'attrAdd';
  combatantId: string;
  combatantName: string;
  jobId?: number;
  attributes: Record<string, string>;
}

/**
 * すべてのイベントに共通のフィールド。
 */
export interface BaseEvent {
  entry: RawLokiEntry;
  timestampNs: bigint;
  timestamp: Date;
}

/** 攻略開始イベント */
export interface StartEvent extends BaseEvent {
  type: 'start';
  content: string;
}

/** 攻略終了イベント */
export interface EndEvent extends BaseEvent {
  type: 'end';
  content: string;
}

/** 与ダメージイベント（メッセージ/構造化の両方から発生） */
export interface DamageEvent extends BaseEvent {
  type: 'damage';
  actor: string | null;
  target: string | null;
  amount: number;
  isCritical: boolean;
  isDirect: boolean;
  source: 'message';
}

/** アビリティ発動イベント（構造化ログ由来） */
export interface AbilityEvent extends BaseEvent {
  type: 'ability';
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  abilityId: string;
  abilityName: string;
}

/** 型に合致しないイベント */
export interface UnknownEvent extends BaseEvent {
  type: 'unknown';
}

const startRegex = /「(.+?)」の攻略を開始した。/;
const endRegex = /「(.+?)」の攻略を終了した。/;

/**
 * Loki の生エントリ配列を、用途別のイベントへパースする。
 * @param entries Loki エントリ配列（時系列順を推奨）
 */
export const parseEvents = (entries: RawLokiEntry[]): ExtendedParsedEvent[] => {
  const events: ExtendedParsedEvent[] = [];
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

/**
 * 1 エントリを適切なイベントへとパースする内部関数。
 */
const parseEntry = (entry: RawLokiEntry): ExtendedParsedEvent | ExtendedParsedEvent[] | null => {
  const { normalized, stream } = entry;
  const parts = normalized.split('|');
  const type = parts[0];
  switch (type) {
    case '00':
      return parseSystemEvent(entry, parts);
    case '03':
      return parseAddCombatant(entry, parts);
    case '04':
      return parseRemoveCombatant(entry, parts);
    case '261':
      return parseAttributeAdd(entry, parts);
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

/**
 * システムメッセージ（00）を解釈してイベント化する。
 */
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

/**
 * AddCombatant（03）の最小解釈。
 * parts[2]=ID, parts[3]=Name を採用し、それ以外の詳細は無視。
 */
const parseAddCombatant = (entry: RawLokiEntry, parts: string[]): AddCombatantEvent | null => {
  if (parts.length < 4) return null;
  const combatantId = parts[2] ?? '';
  const combatantName = parts[3] ?? '';
  return {
    type: 'addCombatant',
    entry,
    timestampNs: BigInt(entry.timestampNs),
    timestamp: entry.timestamp,
    combatantId,
    combatantName
  } satisfies AddCombatantEvent;
};

/**
 * RemoveCombatant（04）の最小解釈。
 */
const parseRemoveCombatant = (entry: RawLokiEntry, parts: string[]): RemoveCombatantEvent | null => {
  if (parts.length < 4) return null;
  const combatantId = parts[2] ?? '';
  const combatantName = parts[3] ?? '';
  return {
    type: 'removeCombatant',
    entry,
    timestampNs: BigInt(entry.timestampNs),
    timestamp: entry.timestamp,
    combatantId,
    combatantName
  } satisfies RemoveCombatantEvent;
};

/**
 * 261 Add の属性列挙を解釈し、Name/Job を抽出する。
 * 形式例: 261|...|Add|<ID>|Key|Val|Key|Val|...|Name|<name>|...|Job|<num>|...
 */
const parseAttributeAdd = (entry: RawLokiEntry, parts: string[]): AttributeAddEvent | null => {
  if (parts.length < 6) return null;
  const kind = parts[2];
  if (kind !== 'Add') return null;
  const combatantId = parts[3] ?? '';
  const attributes: Record<string, string> = {};
  for (let i = 4; i + 1 < parts.length; i += 2) {
    const k = parts[i];
    const v = parts[i + 1];
    if (k) attributes[k] = v ?? '';
  }
  const combatantName = attributes['Name'] ?? '';
  const jobIdStr = attributes['Job'];
  const jobId = jobIdStr && /^\d+$/.test(jobIdStr) ? Number.parseInt(jobIdStr, 10) : undefined;
  return {
    type: 'attrAdd',
    entry,
    timestampNs: BigInt(entry.timestampNs),
    timestamp: entry.timestamp,
    combatantId,
    combatantName,
    jobId,
    attributes
  } satisfies AttributeAddEvent;
};

/**
 * 構造化アビリティログ（21/22）をイベントへ変換する。
 */
const parseStructuredAbility = (
  entry: RawLokiEntry,
  parts: string[],
  stream: Record<string, string>
): ParsedEvent | null => {
  // 21/22 は構造化アビリティ（単体/範囲）。stream に補助情報が入ることを想定し、無い場合は parts をフォールバックで解釈。
  const actor = stream?.actor ?? parts[3] ?? null;
  const target = stream?.target ?? parts[7] ?? null;
  let amount: number | null = null;
  const amountStr = stream?.amount ?? parts[33];
  if (amountStr && /^\d+$/.test(amountStr)) {
    amount = Number.parseInt(amountStr, 10);
  }
  if (amount == null || Number.isNaN(amount)) {
    // 末尾側から最もらしい数値フィールドを検索（ダメージ量と想定）
    for (let i = parts.length - 1; i >= 0; i--) {
      const v = parts[i];
      if (/^\d+$/.test(v)) {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0 && n < 1_000_000_000) {
          amount = n;
          break;
        }
      }
    }
  }
  if (actor && typeof amount === 'number' && !Number.isNaN(amount)) {
    return {
      type: 'damage',
      source: 'message',
      entry,
      timestampNs: BigInt(entry.timestampNs),
      timestamp: entry.timestamp,
      actor,
      target,
      amount,
      isCritical: stream?.isCritical?.toLowerCase?.() === 'true',
      isDirect: stream?.isDirect?.toLowerCase?.() === 'true'
    } satisfies DamageEvent;
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

/**
 * 日本語ログメッセージから与ダメージを抽出する。
 * @returns actor/target/amount/isCritical/isDirect を含むオブジェクト。解釈できない場合は null。
 */
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

  const actorPattern = /^(?<actor>.+?)の攻撃(?: [^に]*?)?\s*(?:クリティカル＆ダイレクトヒット！|クリティカル！|ダイレクトヒット！)?\s*(?<target>[^に]+)に\d+(?:\([^)]*\))?ダメージ。$/;
  const directPattern = /^(?:クリティカル＆ダイレクトヒット！|クリティカル！|ダイレクトヒット！)\s*(?<target>[^に]+)に\d+(?:\([^)]*\))?ダメージ。$/;

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

  const simplePattern = /^(?<target>[^に]+)に\d+(?:\([^)]*\))?ダメージ。$/;
  const simpleMatch = simplePattern.exec(cleaned);
  if (simpleMatch?.groups) {
    const target = cleanupTarget(simpleMatch.groups.target);
    return { actor: null, target, amount, isCritical, isDirect };
  }

  return null;
};

/**
 * 対象文字列から不要な語を除去する。
 */
const cleanupTarget = (value: string): string =>
  value
    .replace(/は受け流した！/, '')
    .replace(/はブロックした！/, '')
    .trim();

/** Type Guard: 攻略開始 */
export const isStartEvent = (event: ExtendedParsedEvent): event is StartEvent => (event as any).type === 'start';
/** Type Guard: 攻略終了 */
export const isEndEvent = (event: ExtendedParsedEvent): event is EndEvent => (event as any).type === 'end';
/** Type Guard: 与ダメージ */
export const isDamageEvent = (event: ExtendedParsedEvent): event is DamageEvent => (event as any).type === 'damage';
/** Type Guard: アビリティ */
export const isAbilityEvent = (event: ExtendedParsedEvent): event is AbilityEvent => (event as any).type === 'ability';

/** Type Guard: AddCombatant */
export const isAddCombatantEvent = (event: ExtendedParsedEvent): event is AddCombatantEvent =>
  (event as any).type === 'addCombatant';
/** Type Guard: RemoveCombatant */
export const isRemoveCombatantEvent = (event: ExtendedParsedEvent): event is RemoveCombatantEvent =>
  (event as any).type === 'removeCombatant';
/** Type Guard: 261 Add attributes */
export const isAttributeAddEvent = (event: ExtendedParsedEvent): event is AttributeAddEvent =>
  (event as any).type === 'attrAdd';
