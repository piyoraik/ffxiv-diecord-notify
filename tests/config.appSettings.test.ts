// 設定値の取得ロジックのテスト。
// - 既定値の適用
// - 環境変数による上書き
// - 不正値時のフォールバック（クランプ含む）
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('appSettings: defaults and overrides', async () => {
  const original = { ...process.env };
  try {
    // Clear to ensure defaults
    delete process.env.AGGREGATION_START_HOUR_JST;
    delete process.env.AGGREGATION_END_HOUR_JST;
    delete process.env.APP_TIME_ZONE;
    const cfgMod = await import('../src/config.js');
    assert.equal(cfgMod.appSettings.aggregationStartHourJst(), 10);
    assert.equal(cfgMod.appSettings.aggregationEndHourJst(), 10);
    assert.equal(cfgMod.appSettings.timeZone(), 'Asia/Tokyo');

    // Override with env
    process.env.AGGREGATION_START_HOUR_JST = '8';
    process.env.AGGREGATION_END_HOUR_JST = '6';
    process.env.APP_TIME_ZONE = 'Asia/Seoul';
    // Re-import to pick up new env (cache-busting via query)
    const cfgMod2 = await import('../src/config.js?2');
    assert.equal(cfgMod2.appSettings.aggregationStartHourJst(), 8);
    assert.equal(cfgMod2.appSettings.aggregationEndHourJst(), 6);
    assert.equal(cfgMod2.appSettings.timeZone(), 'Asia/Seoul');

    // Invalid -> fallback + clamp
    process.env.AGGREGATION_START_HOUR_JST = '-1';
    const cfgMod3 = await import('../src/config.js?3');
    assert.equal(cfgMod3.appSettings.aggregationStartHourJst(), 10);
  } finally {
    process.env = original;
  }
});
