// Discord のコマンドハンドラ（依存注入版）のテスト。
// Interaction をシンプルなモックで置き換え、分岐とメッセージ生成を検証します。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTestCommandWith, handleDpsCommandWith } from '../src/discord/handlers.js';

/**
 * テストで使用する簡易 Interaction モック。
 * - `options` 経由で引数を返す
 * - `deferReply`/`editReply`/`reply` の呼び出し内容を記録
 */
const makeInteraction = (opts: Partial<Record<string, any>> = {}) => {
  const calls: any[] = [];
  const interaction: any = {
    deferred: false,
    replied: false,
    options: {
      getString: (k: string) => opts[k] ?? null,
      getBoolean: (k: string) => (opts[k] === undefined ? null : !!opts[k]),
      getInteger: (k: string) => (opts[k] === undefined ? null : Number(opts[k]))
    },
    async deferReply(arg: any) { calls.push(['defer', arg]); this.deferred = true; },
    async editReply(arg: any) { calls.push(['edit', arg]); this.replied = true; },
    async reply(arg: any) { calls.push(['reply', arg]); this.replied = true; }
  };
  return { interaction, calls } as const;
};

test('handleTestCommandWith: no summary -> error message', async () => {
  const { interaction, calls } = makeInteraction({ date: '2024-10-08', ephemeral: true });
  await handleTestCommandWith(interaction as any, {
    summarize: async () => ({ summary: null, availableDates: [] }),
    format: () => 'should not be called'
  });
  // 1) defer, 2) edit with error text
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'edit');
  assert.ok(String(calls[1][1]).includes('Loki から対象日のログが見つかりませんでした'));
});

test('handleTestCommandWith: summary exists -> formatted content', async () => {
  const { interaction, calls } = makeInteraction({ date: '2024-10-08' });
  await handleTestCommandWith(interaction as any, {
    summarize: async () => ({ summary: { date: '2024-10-08', entries: [], issues: [] }, availableDates: ['2024-10-08'] }),
    format: () => 'FORMATTED'
  });
  assert.equal(calls[1][0], 'edit');
  const payload = calls[1][1];
  assert.equal(payload.content, 'FORMATTED');
});

test('handleDpsCommandWith: multiple segments and no index -> list message', async () => {
  const { interaction, calls } = makeInteraction({ date: '2024-10-08' });
  await handleDpsCommandWith(interaction as any, {
    fetchDaily: async () => ({ date: '2024-10-08', segments: [
      { content: 'A', players: [], ordinal: 1, globalIndex: 1, start: null, end: null, status: 'completed', durationMs: 1000 },
      { content: 'B', players: [], ordinal: 1, globalIndex: 2, start: null, end: null, status: 'completed', durationMs: 2000 }
    ], availableDates: ['2024-10-08'] }),
    formatList: () => 'LIST',
    formatDetail: () => 'DETAIL'
  });
  assert.equal(calls[1][0], 'edit');
  assert.equal(calls[1][1], 'LIST');
});

test('handleDpsCommandWith: invalid index -> validation error', async () => {
  const { interaction, calls } = makeInteraction({ index: 3 });
  await handleDpsCommandWith(interaction as any, {
    fetchDaily: async () => ({ date: 'd', segments: [
      { content: 'A', players: [], ordinal: 1, globalIndex: 1, start: null, end: null, status: 'completed', durationMs: 1000 },
      { content: 'B', players: [], ordinal: 1, globalIndex: 2, start: null, end: null, status: 'completed', durationMs: 2000 }
    ], availableDates: [] }),
    formatList: () => 'LIST',
    formatDetail: () => 'DETAIL'
  });
  assert.equal(calls[1][0], 'edit');
  const msg = String(calls[1][1]);
  assert.ok(msg.includes('index は 1 〜 2 の範囲で指定してください。'));
});

test('handleDpsCommandWith: single segment -> detail message', async () => {
  const { interaction, calls } = makeInteraction({});
  await handleDpsCommandWith(interaction as any, {
    fetchDaily: async () => ({ date: 'd', segments: [
      { content: 'A', players: [], ordinal: 1, globalIndex: 1, start: null, end: null, status: 'completed', durationMs: 1000 }
    ], availableDates: [] }),
    formatList: () => 'LIST',
    formatDetail: () => 'DETAIL'
  });
  assert.equal(calls[1][0], 'edit');
  assert.equal(calls[1][1], 'DETAIL');
});
