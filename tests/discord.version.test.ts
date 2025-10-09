import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleVersionCommand } from '../src/discord/handlers.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

// 簡易 Interaction モック（reply の呼び出し内容を記録）
const makeInteraction = () => {
  const calls: any[] = [];
  const interaction: any = {
    async reply(arg: any) {
      calls.push(arg);
    }
  };
  return { interaction, calls } as const;
};

test('/version: replies with version and build timestamp in JST (from env)', async () => {
  const original = { ...process.env };
  try {
    process.env.BUILD_TIMESTAMP = '2025-01-02T03:04:05Z'; // => JST 12:04:05 on same day
    const { interaction, calls } = makeInteraction();
    await handleVersionCommand(interaction as any);
    assert.equal(calls.length, 1);
    const payload = calls[0];
    assert.equal(payload.ephemeral, true);
    assert.ok(String(payload.content).includes(`v${(pkg as any).version}`));
    // JST 表示を含む（日時と JST ラベル）
    assert.ok(String(payload.content).includes('2025-01-02'));
    assert.ok(String(payload.content).includes('12:04:05'));
    assert.ok(String(payload.content).includes('JST'));
  } finally {
    process.env = original;
  }
});
