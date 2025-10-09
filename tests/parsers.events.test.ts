// イベントパーサの単体テスト。
// - 日本語メッセージからの与ダメージ抽出（クリ/ダイレクトの有無など）
// - Loki の生ログエントリから Start/End/Ability/Damage を判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDamageMessage, parseEvents } from '../src/parsers/events.js';
import type { RawLokiEntry } from '../src/loki/client.js';

// Loki から返る 1 レコード相当のテスト用データ作成ヘルパ
const makeEntry = (normalized: string, stream: Record<string, string> = {}): RawLokiEntry => ({
  timestampNs: String(1728380689000000000n),
  timestamp: new Date(Number(1728380689000000000n / 1_000_000n)),
  normalized,
  stream
});

// アクター/クリ/ダイレクト/ターゲット/ダメージ量の全要素が埋まるパターン
test('parseDamageMessage: actor + crit+direct + target + amount', () => {
  const msg = '太郎の攻撃 クリティカル＆ダイレクトヒット！ 花子に123ダメージ。';
  const res = parseDamageMessage(msg);
  assert.ok(res);
  assert.equal(res!.actor, '太郎');
  assert.equal(res!.target, '花子');
  assert.equal(res!.amount, 123);
  assert.equal(res!.isCritical, true);
  assert.equal(res!.isDirect, true);
});

// クリティカルのみでアクター不明のパターン
test('parseDamageMessage: no actor (crit only)', () => {
  const msg = 'クリティカル！ 花子に456ダメージ。';
  const res = parseDamageMessage(msg);
  assert.ok(res);
  assert.equal(res!.actor, null);
  assert.equal(res!.target, '花子');
  assert.equal(res!.amount, 456);
  assert.equal(res!.isCritical, true);
  assert.equal(res!.isDirect, false);
});

// 最小形（ターゲットとダメージのみ）のパターン
test('parseDamageMessage: simple target only', () => {
  const msg = '花子に789ダメージ。';
  const res = parseDamageMessage(msg);
  assert.ok(res);
  assert.equal(res!.actor, null);
  assert.equal(res!.target, '花子');
  assert.equal(res!.amount, 789);
});

// ターゲット名に「は受け流した！/はブロックした！」が混入していても
// cleanupTarget により除去され、素の名前が取れること
test('parseDamageMessage: cleans target artifacts like 受け流した/ブロックした', () => {
  // 実ログ想定：ターゲット名の直後に「は受け流した！」等が挟まるケース
  // 例: 「太郎の攻撃 クリティカル！ 花子は受け流した！ に100ダメージ。」
  const msg = '太郎の攻撃 クリティカル！ 花子は受け流した！ に100ダメージ。';
  const res = parseDamageMessage(msg);
  assert.ok(res);
  assert.equal(res!.actor, '太郎');
  assert.equal(res!.target, '花子');
  assert.equal(res!.amount, 100);
  assert.equal(res!.isCritical, true);
});

// クリティカルではなくダイレクトヒットのみの短縮パターン
test('parseDamageMessage: direct only (no actor)', () => {
  const msg = 'ダイレクトヒット！ 花子に50ダメージ。';
  const res = parseDamageMessage(msg);
  assert.ok(res);
  assert.equal(res!.actor, null);
  assert.equal(res!.target, '花子');
  assert.equal(res!.amount, 50);
  assert.equal(res!.isDirect, true);
});

// 00 メッセージを開始/終了イベントへ正しく変換できること
test('parseEvents: start/end system messages', () => {
  const start = makeEntry('00|dummy|x|y|「ダンジョンA」の攻略を開始した。');
  const end = makeEntry('00|dummy|x|y|「ダンジョンA」の攻略を終了した。');
  const events = parseEvents([start, end]);
  assert.equal(events.length, 2);
  assert.equal((events[0] as any).type, 'start');
  assert.equal((events[0] as any).content, 'ダンジョンA');
  assert.equal((events[1] as any).type, 'end');
  assert.equal((events[1] as any).content, 'ダンジョンA');
});

// 21/22（構造化）からダメージイベントへ変換できること
test('parseEvents: structured ability -> damage event', () => {
  const e = makeEntry('21', {
    type: 'ability',
    actor: '太郎',
    target: '花子',
    amount: '321',
    isCritical: 'true',
    isDirect: 'false'
  });
  const events = parseEvents([e]);
  assert.equal(events.length, 1);
  const d = events[0] as any;
  assert.equal(d.type, 'damage');
  assert.equal(d.actor, '太郎');
  assert.equal(d.target, '花子');
  assert.equal(d.amount, 321);
  assert.equal(d.isCritical, true);
  assert.equal(d.isDirect, false);
});

test('parseEvents: structured ability amount fallback from parts tail', () => {
  // stream に amount が無い場合、行末尾の数値をダメージ量として解釈できることを確認
  const e = makeEntry('21|x|100|太郎|200|技|300|花子|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|...|999');
  const events = parseEvents([e]);
  const d = events[0] as any;
  assert.equal(d.type, 'damage');
  assert.equal(d.actor, '太郎');
  assert.equal(d.target, '花子');
  assert.equal(d.amount, 999);
});

// 構造化 ability の actor が stream に無い場合、parts[3] から補完されること
test('parseEvents: structured ability actor fallback from parts', () => {
  // normalized の index: 0:type 1:? 2:sourceId 3:sourceName 4:abilityId 5:abilityName 6:targetId 7:targetName
  const entry = makeEntry('21|x|100|太郎|200|技|300|花子', {
    type: 'ability',
    // actor は指定しない（fallback 用）
    amount: '111',
    isCritical: 'false',
    isDirect: 'true'
  });
  const events = parseEvents([entry]);
  assert.equal(events.length, 1);
  const d = events[0] as any;
  assert.equal(d.type, 'damage');
  assert.equal(d.actor, '太郎');
  assert.equal(d.target, '花子');
  assert.equal(d.amount, 111);
  assert.equal(d.isCritical, false);
  assert.equal(d.isDirect, true);
});
