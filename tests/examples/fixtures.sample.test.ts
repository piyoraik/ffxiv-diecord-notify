import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEvents } from '../../src/parsers/events.js';
import type { RawLokiEntry } from '../../src/loki/client.js';

// NDJSON を読み込み、最小限の RawLokiEntry に変換するデモ。
const ndjsonPath = path.resolve(process.cwd(), 'tests/fixtures/loki/lines.ndjson');

const normalize = (input: string): string => {
  let s = input;
  if (s.startsWith('line=')) s = s.slice(5);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
};

test('fixtures: parseEvents from NDJSON corpus', () => {
  const lines = fs.readFileSync(ndjsonPath, 'utf-8').trim().split(/\r?\n/);
  const entries: RawLokiEntry[] = lines.map(line => {
    const obj = JSON.parse(line);
    return {
      timestampNs: obj.timestamp_ns,
      timestamp: new Date(Number(BigInt(obj.timestamp_ns) / 1_000_000n)),
      normalized: normalize(obj.line),
      stream: obj.stream || {}
    };
  });
  const events = parseEvents(entries);
  assert.equal(events.length, 2);
});

