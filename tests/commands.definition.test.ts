import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandList, versionCommand } from '../src/commands.js';

test('commands: commandList contains test, dps, version', () => {
  const names = commandList.map(c => (c as any).name ?? (c as any).toJSON?.().name);
  // Fallback: toJSON may be required to access the name in some discord.js versions
  const normalized = names.map(n => (n ? n : null)).filter(Boolean) as string[];
  assert.ok(normalized.includes('test'));
  assert.ok(normalized.includes('dps'));
  assert.ok(normalized.includes('version'));
});

test('commands: versionCommand toJSON has correct name/description', () => {
  const json = (versionCommand as any).toJSON();
  assert.equal(json.name, 'version');
  assert.ok(typeof json.description === 'string' && json.description.length > 0);
});

