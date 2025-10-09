// スラッシュコマンド登録処理のユニットテスト。
// REST クライアントと Routes をスタブして、正しいエンドポイントに
// 正しいボディで PUT されることを検証します。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import assert from 'node:assert/strict';

test('registerCommands: calls REST.put with command JSON body', async () => {
  const originalEnv = { ...process.env } as NodeJS.ProcessEnv;
  const restores: Array<() => void> = [];
  try {
    process.env.DISCORD_TOKEN = 'tkn';
    process.env.DISCORD_CLIENT_ID = 'cid';
    process.env.DISCORD_GUILD_ID = 'gid';

    const calls: any[] = [];

    // registerCommandsWith を呼び出し、Fake REST/Routes 経由でパスとボディを検証
    const { registerCommandsWith } = await import('../src/registerCommands.js');
    const Routes = { applicationGuildCommands: (clientId: string, guildId: string) => `/apps/${clientId}/guilds/${guildId}/commands` } as any;
    // Minimal REST stub with setToken + put
    class FakeREST {
      private token?: string;
      setToken(t: string) { this.token = t; return this; }
      async put(path: string, init: any) { calls.push({ path, init, token: this.token }); }
    }
    const rest = new FakeREST().setToken('tkn') as any;
    const commands = [{ toJSON: () => ({ name: 'one' }) }, { toJSON: () => ({ name: 'two' }) }];
    await registerCommandsWith(rest, Routes, 'cid', 'gid', commands);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/apps/cid/guilds/gid/commands');
    assert.deepEqual(calls[0].init.body, [{ name: 'one' }, { name: 'two' }]);
    assert.equal(calls[0].token, 'tkn');
  } finally {
    process.env = originalEnv;
    restores.forEach(fn => fn());
  }
});
