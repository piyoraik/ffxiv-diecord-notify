// 表示整形関数の単体テスト。
// - 一覧、詳細、日次要約それぞれで最低限の文字列が含まれることを確認します。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDpsDetailMessage, formatDpsListMessage, formatSummaryMessage } from '../src/logParser.js';
import type { CombatSegmentSummary, PlayerStats } from '../src/types/combat.js';

// サンプルのプレイヤー配列（DPS 表示で用いる）
const samplePlayers: PlayerStats[] = [
  { name: 'A', totalDamage: 12000, dps: 4000, hits: 30, criticalHits: 10, directHits: 5 },
  { name: 'B', totalDamage: 8000, dps: 2666.7, hits: 25, criticalHits: 6, directHits: 3 }
];

// サンプルの攻略セグメント 1 件
const sampleSegment = (ordinal: number, content = 'ダンジョンA'): CombatSegmentSummary => ({
  id: `seg-${ordinal}`,
  globalIndex: ordinal,
  ordinal,
  content,
  start: new Date('2024-10-08T01:00:00.000Z'),
  end: new Date('2024-10-08T01:30:45.000Z'),
  status: 'completed',
  durationMs: 1845000,
  players: samplePlayers
});

test('formatDpsListMessage: lists segments with top DPS', () => {
  const segs = [sampleSegment(1), sampleSegment(2, 'ダンジョンB')];
  const msg = formatDpsListMessage('2024-10-08', segs);
  assert.ok(msg.includes('📊 2024-10-08 の攻略一覧'));
  assert.ok(msg.includes('1. 「ダンジョンA」 #1'));
  assert.ok(msg.includes('2. 「ダンジョンB」 #2'));
  assert.ok(msg.includes('Top: A 4000 DPS'));
});

test('formatDpsDetailMessage: shows ranking lines', () => {
  const seg = sampleSegment(1);
  const msg = formatDpsDetailMessage(seg, '2024-10-08');
  assert.ok(msg.includes('📊 2024-10-08 「ダンジョンA」 #1'));
  assert.ok(msg.includes('DPSランキング:'));
  assert.ok(msg.includes('1. A 4000'));
  assert.ok(msg.includes('2. B 2667'));
});

test('formatSummaryMessage: includes issues and available dates', () => {
  const summary = {
    date: '2024-10-08',
    entries: [
      {
        content: 'ダンジョンA',
        start: new Date('2024-10-08T01:00:00.000Z'),
        end: new Date('2024-10-08T01:30:45.000Z'),
        durationMs: 1845000,
        status: 'completed' as const,
        players: samplePlayers,
        ordinal: 1,
        globalIndex: 1
      }
    ],
    issues: ['開始ログなし: 「ダンジョンB」 (終了 2024-10-08T02:00:00.000Z)']
  };
  const msg = formatSummaryMessage(summary, ['2024-10-07', '2024-10-08']);
  assert.ok(msg.includes('📅 2024-10-08 の攻略履歴'));
  assert.ok(msg.includes('⚠️ ペアリングに失敗したログがあります'));
  assert.ok(msg.includes('📚 利用可能な日付: 2024-10-07, 2024-10-08'));
});
