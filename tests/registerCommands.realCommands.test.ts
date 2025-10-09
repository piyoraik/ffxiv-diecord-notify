import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCommandsWith } from '../src/registerCommands.js';
import { commandList } from '../src/commands.js';

test('registerCommandsWith: sends real commandList including version', async () => {
  const calls: any[] = [];
  class FakeREST {
    private token?: string;
    setToken(t: string) { this.token = t; return this; }
    async put(path: string, init: any) { calls.push({ path, init, token: this.token }); }
  }
  const Routes = {
    applicationGuildCommands: (clientId: string, guildId: string) => `/apps/${clientId}/guilds/${guildId}/commands`
  } as any;

  const rest = new FakeREST().setToken('tkn') as any;
  await registerCommandsWith(rest, Routes, 'cid', 'gid', commandList as any);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/apps/cid/guilds/gid/commands');
  const body = calls[0].init.body as any[];
  const names = body.map(b => b.name);
  assert.ok(names.includes('version'));
  assert.ok(names.includes('test'));
  assert.ok(names.includes('dps'));
});

