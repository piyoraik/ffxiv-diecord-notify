// セグメント構築と DPS 集計のテスト。
// - 開始/終了のペアリングと出現順（ordinal）
// - セグメント内の与ダメージを集約し、プレイヤー別に並べ替え
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StartEvent, EndEvent, DamageEvent } from '../src/parsers/events.js';

// イベント生成ヘルパ（時刻はナノ秒で合わせる）
const mkStart = (ns: bigint, content: string): StartEvent => ({
  type: 'start',
  content,
  entry: { timestampNs: String(ns), timestamp: new Date(Number(ns / 1_000_000n)), normalized: '', stream: {} },
  timestampNs: ns,
  timestamp: new Date(Number(ns / 1_000_000n))
});

const mkEnd = (ns: bigint, content: string): EndEvent => ({
  type: 'end',
  content,
  entry: { timestampNs: String(ns), timestamp: new Date(Number(ns / 1_000_000n)), normalized: '', stream: {} },
  timestampNs: ns,
  timestamp: new Date(Number(ns / 1_000_000n))
});

const mkDamage = (ns: bigint, actor: string, amount: number): DamageEvent => ({
  type: 'damage',
  source: 'message',
  entry: { timestampNs: String(ns), timestamp: new Date(Number(ns / 1_000_000n)), normalized: '', stream: {} },
  timestampNs: ns,
  timestamp: new Date(Number(ns / 1_000_000n)),
  actor,
  target: null,
  amount,
  isCritical: false,
  isDirect: false
});

const mkAdd = (ns: bigint, id: string, name: string) => ({
  type: 'addCombatant' as const,
  combatantId: id,
  combatantName: name,
  timestampNs: ns,
  timestamp: new Date(Number(ns / 1_000_000n)),
  entry: { timestampNs: String(ns), timestamp: new Date(Number(ns / 1_000_000n)), normalized: '', stream: {} }
});

const mkAttrAdd = (ns: bigint, id: string, name: string, jobId: number) => ({
  type: 'attrAdd' as const,
  combatantId: id,
  combatantName: name,
  jobId,
  attributes: {},
  timestampNs: ns,
  timestamp: new Date(Number(ns / 1_000_000n)),
  entry: { timestampNs: String(ns), timestamp: new Date(Number(ns / 1_000_000n)), normalized: '', stream: {} }
});

// 開始/終了の組み合わせから 2 セグメントを構築し、ordinal が 1,2 となることを確認
test('buildSegments + assignOrdinals: pairs start/end and orders with ordinals', async () => {
  const mod = await import('../src/services/combatAnalyzer.js?seg1');
  const { __testables } = mod as any;
  const events = [
    mkStart(1000n, 'A'),
    mkEnd(2000n, 'A'),
    mkStart(3000n, 'A'),
    mkEnd(4000n, 'A')
  ];
  const segments = __testables.buildSegments(events);
  __testables.assignOrdinals(segments);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].content, 'A');
  assert.equal(segments[0].status, 'completed');
  assert.equal(segments[0].ordinal, 1);
  assert.equal(segments[1].ordinal, 2);
});

// セグメント範囲内のダメージだけを集計し、DPS 順に並ぶことを確認
test('attachDamageToSegments: aggregates DPS per player within segment bounds', async () => {
  const mod = await import('../src/services/combatAnalyzer.js?seg2');
  const { __testables } = mod as any;
  const events = [mkStart(1000n, 'A'), mkEnd(4000n, 'A')];
  const segments = __testables.buildSegments(events);
  const dmg = [
    mkDamage(1500n, 'Alice', 1000),
    mkDamage(2000n, 'Alice', 1000),
    mkDamage(3500n, 'Bob', 500),
    mkDamage(5000n, 'Alice', 999) // out of segment -> ignored
  ];
  __testables.attachDamageToSegments(segments, dmg, new Set(['Alice', 'Bob']));
  assert.equal(segments[0].players.length, 2);
  const names = segments[0].players.map((p: any) => p.name);
  assert.deepEqual(names, ['Alice', 'Bob']);
});

test('assignParticipants: uses add/remove within timeline to estimate attendees', async () => {
  const mod = await import('../src/services/combatAnalyzer.js?seg3');
  const { __testables } = mod as any;
  const events = [mkStart(2000n, 'A'), mkEnd(5000n, 'A')];
  const segments = __testables.buildSegments(events);

  // Add players before/within segment, remove one before segment start → 除外
  const addEvents = [
    { type: 'addCombatant', combatantId: '10123456', combatantName: 'Alice', timestampNs: 1500n, timestamp: new Date(Number(1500n/1_000_000n)), entry: { timestampNs: '1500', timestamp: new Date(Number(1500n/1_000_000n)), normalized: '', stream: {} } },
    { type: 'addCombatant', combatantId: '10999999', combatantName: 'Bob', timestampNs: 3000n, timestamp: new Date(Number(3000n/1_000_000n)), entry: { timestampNs: '3000', timestamp: new Date(Number(3000n/1_000_000n)), normalized: '', stream: {} } }
  ];
  const removeEvents = [
    { type: 'removeCombatant', combatantId: '10123456', combatantName: 'Alice', timestampNs: 1800n, timestamp: new Date(Number(1800n/1_000_000n)), entry: { timestampNs: '1800', timestamp: new Date(Number(1800n/1_000_000n)), normalized: '', stream: {} } }
  ];

  __testables.assignParticipants(segments, addEvents, removeEvents);
  assert.equal(segments[0].participants.length >= 1, true);
  // Alice removed before start → not included; Bob added during segment → included
  assert.equal(segments[0].participants.includes('Alice'), false);
  assert.equal(segments[0].participants.includes('Bob'), true);
});

test('buildPlayerRegistry updates job mapping when attrAdd reports new job', async () => {
  const mod = await import('../src/services/combatAnalyzer.js?jobChange');
  const { __testables } = mod as any;
  const addEvents = [mkAdd(1000n, '10123456', 'Piyo Lambda')];
  const attrAddEvents = [
    mkAttrAdd(1500n, '10123456', 'Piyo Lambda', 42), // PCT
    mkAttrAdd(2000n, '10123456', 'Piyo Lambda', 19) // PLD
  ];
  const { nameToJobCode, idToJobCode } = __testables.buildPlayerRegistry(addEvents, attrAddEvents);
  assert.equal(nameToJobCode.get('Piyo Lambda'), 'PLD');
  assert.equal(idToJobCode.get('10123456'), 'PLD');
});
