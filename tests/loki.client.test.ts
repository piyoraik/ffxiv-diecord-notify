// Loki クライアントのユニットテスト。
// fetch をテスト内でモックし、ページング・重複排除・昇順ソート・
// クエリ結合（正規表現/生パイプ）の動作を確認します。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('queryLogsInRange: paginates, deduplicates, and sorts ascending', async () => {
  const original = { ...process.env } as NodeJS.ProcessEnv;
  const restore: Array<() => void> = [];
  try {
    process.env.LOKI_BASE_URL = 'http://example.com';
    process.env.LOKI_QUERY = '{job="x"}';
    process.env.LOKI_QUERY_FILTER = 'error.*';
    process.env.LOKI_QUERY_LIMIT = '2';
    process.env.LOKI_CHUNK_HARD_LIMIT = '100';

    const m = await import('../src/loki/client.js?lk1');
    const { queryLogsInRange } = m as any;

    let call = 0;
    // 1 回目: 2 件返して limit 到達 → 2 回目呼ばれる
    // 2 回目: 0 件→停止
    const r = mock.method(global as any, 'fetch', async (input: any) => {
      call += 1;
      const u = new URL(input.toString());
      // First call returns 2 entries (limit reached)
      if (call === 1) {
        // Verify query parameter composition (|~ "...") when filter does not start with '|'
        const q = u.searchParams.get('query')!;
        assert.ok(q.includes('|~ "error.*"'));
        const payload = {
          data: {
            result: [
              {
                stream: { job: 'x' },
                values: [
                  [String(1000n), 'line="00|a|b|c|msg1"'],
                  [String(1001n), 'line="00|a|b|c|msg1"'] // duplicate by normalized and ts? same ts+line -> later dedup
                ]
              },
              {
                stream: { job: 'x', extra: '1' },
                values: [[String(1001n), 'line="00|a|b|c|msg2"']]
              }
            ]
          }
        };
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Second call: no more data, should stop
      const payload = { data: { result: [] } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    restore.push(() => r.mock.restore());

    const start = new Date(0);
    const end = new Date(10_000);
    const res = await queryLogsInRange(start, end);
    // Expect 3 entries (duplicate removed)
    assert.equal(res.length, 3);
    // Sorted ascending by timestampNs
    const ns = res.map((e: any) => BigInt(e.timestampNs));
    assert.deepEqual(ns, [1000n, 1001n, 1001n]);
  } finally {
    process.env = original;
    restore.forEach(fn => fn());
  }
});

test('queryLogsInRange: honors raw filter starting with pipe', async () => {
  const original = { ...process.env } as NodeJS.ProcessEnv;
  const restore: Array<() => void> = [];
  try {
    process.env.LOKI_BASE_URL = 'http://example.com';
    process.env.LOKI_QUERY = '{job="x"}';
    process.env.LOKI_QUERY_FILTER = '| json';
    process.env.LOKI_QUERY_LIMIT = '1';
    const m = await import('../src/loki/client.js?lk2');
    const { queryLogsInRange } = m as any;

    // フィルタが `| ` で始まる場合はそのまま末尾に結合されることを検証
    const r = mock.method(global as any, 'fetch', async (input: any) => {
      const u = new URL(input.toString());
      const q = u.searchParams.get('query')!;
      assert.ok(q.endsWith('| json'));
      const payload = {
        data: { result: [{ stream: {}, values: [[String(1000n), 'line="m"']]}] }
      };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    restore.push(() => r.mock.restore());

    const res = await queryLogsInRange(new Date(0), new Date(10));
    assert.equal(res.length, 1);
  } finally {
    process.env = original;
    restore.forEach(fn => fn());
  }
});
