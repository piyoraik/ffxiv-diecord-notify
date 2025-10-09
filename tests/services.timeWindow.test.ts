// このテストでは、アプリが「JST の開始/終了時刻」を使って
// 集計対象の時間窓（UTC の開始/終了）を正しく計算できるかを確認します。
// 具体的には、開始=10:00、終了=08:00（翌日）という設定で、
// 指定日 2024-10-08 の集計範囲が
// UTC では start=01:00, end=23:00 になることを検証します。
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('determineTimeWindow: JST 10:00 to next-day 08:00', async () => {
  const original = { ...process.env };
  try {
    process.env.AGGREGATION_START_HOUR_JST = '10';
    process.env.AGGREGATION_END_HOUR_JST = '8';
    const mod = await import('../src/services/combatAnalyzer.js' + '?tw1');
    const { __testables } = mod as any;
    const { startDate, endDate, targetDate } = __testables.determineTimeWindow('2024-10-08');
    assert.equal(targetDate, '2024-10-08');
    // In UTC: start = 2024-10-08T01:00:00.000Z, end = 2024-10-08T23:00:00.000Z
    assert.equal(startDate.toISOString(), '2024-10-08T01:00:00.000Z');
    assert.equal(endDate.toISOString(), '2024-10-08T23:00:00.000Z');
  } finally {
    process.env = original;
  }
});
