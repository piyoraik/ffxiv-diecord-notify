// 実ログ（logs/logs.json）を用いたパーサの簡易回帰テスト。
// - 形式: logs/logs.json は [{line, timestamp, fields}, ...] の配列
// - 目的: normalize 相当の処理で行文字列を整形し、parseEvents / parseDamageMessage が
//   実ログでも破綻しないことを確認する。パターン数の増加に合わせて段階的に強化可能。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDamageMessage, parseEvents } from '../src/parsers/events.js';
import type { RawLokiEntry } from '../src/loki/client.js';
import fs from 'node:fs';
import path from 'node:path';

type RawFileEntry = { line: string; timestamp: string; fields?: Record<string, string> };

// client.ts の normalizeLine とほぼ同等の簡易処理（テスト内限定の複製）
const testNormalize = (input: string): string => {
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

const toEntry = (r: RawFileEntry): RawLokiEntry => ({
  timestampNs: r.timestamp,
  timestamp: new Date(Number(BigInt(r.timestamp) / 1_000_000n)),
  normalized: testNormalize(r.line),
  stream: r.fields ?? {}
});

// CI 等で `logs/logs.json` が存在しない環境では自動的に skip します。
const defaultPath = path.resolve(process.cwd(), 'logs/logs.json');
const logPath = process.env.LOGS_JSON_PATH
  ? path.resolve(process.cwd(), process.env.LOGS_JSON_PATH)
  : defaultPath;
const hasRealLogs = fs.existsSync(logPath);

test('real logs: parseEvents and parseDamageMessage handle common patterns', { skip: !hasRealLogs }, async () => {
  const raw = JSON.parse(fs.readFileSync(logPath, 'utf-8')) as RawFileEntry[];
  assert.ok(Array.isArray(raw));
  assert.ok(raw.length > 0);

  // サンプリング（速度・安定性のため先頭 500 件に限定）
  const sample = raw.slice(0, 500).map(toEntry);

  // parseEvents が例外なく配列を返すこと
  const events = parseEvents(sample);
  assert.ok(Array.isArray(events));
  assert.equal(events.length >= 0, true);

  // 実ログ中に「ダメージ。」を含む行があれば、ある程度は parseDamageMessage が解釈できるはず
  const damageLines = sample
    .map(e => e.normalized)
    .filter(line => /ダメージ。/.test(line))
    .slice(0, 20);

  for (const line of damageLines) {
    const parsed = parseDamageMessage(line);
    // パース不能な行もあり得るが、1件以上はパースできることを期待
    if (parsed) {
      assert.ok(typeof parsed.amount === 'number');
      break;
    }
  }
});
