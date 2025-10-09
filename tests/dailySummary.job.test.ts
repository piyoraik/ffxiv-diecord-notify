// 日次通知ジョブの単体テスト。
// 実際の Discord/Secrets を触らずに、依存を注入して動作を検証します。
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('dailySummary job: logs in, fetches channel, sends no-records message, destroys client', async () => {
  const { runDailySummaryWithClient } = await import('../src/jobs/dailySummary.js');

  // Fake Discord client
  const sent: string[] = [];
  let destroyed = false;
  let loggedInWith: string | undefined;

  class FakeClient {
    public channels = {
      fetch: async (_id: string) => ({ type: 0, send: async (msg: string) => { sent.push(msg); } })
    };
    async login(token: string) { loggedInWith = token; }
    async destroy() { destroyed = true; }
  }

  // Mock summarizer to return empty entries
  const summarize = async (_date: string) => ({ summary: { date: '2024-10-08', entries: [], issues: [] }, availableDates: ['2024-10-08'] });
  const format = (_s: any, _a: string[]) => 'formatted';

  await runDailySummaryWithClient(new FakeClient() as any, 'tkn', 'chid', summarize as any, format as any);

  assert.equal(loggedInWith, 'tkn');
  assert.equal(destroyed, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('📅'));
  assert.ok(sent[0].includes('の攻略記録は見つかりませんでした。'));
});
