import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleVersionCommand } from '../src/discord/handlers.js';
import pkg from '../package.json' assert { type: 'json' };

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

test('/version: replies with version and build timestamp (from env)', async () => {
  const original = { ...process.env };
  try {
    process.env.BUILD_TIMESTAMP = '2025-01-02T03:04:05Z';
    const { interaction, calls } = makeInteraction();
    await handleVersionCommand(interaction as any);
    assert.equal(calls.length, 1);
    const payload = calls[0];
    assert.equal(payload.ephemeral, true);
    assert.ok(String(payload.content).includes(`v${(pkg as any).version}`));
    assert.ok(String(payload.content).includes('2025-01-02T03:04:05Z'));
  } finally {
    process.env = original;
  }
});

