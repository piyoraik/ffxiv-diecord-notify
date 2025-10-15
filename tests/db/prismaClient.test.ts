import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildDatabaseUrlFromPgEnv } from '../../src/db/prisma.js';

test('buildDatabaseUrlFromPgEnv returns undefined when insufficient env', () => {
  assert.equal(buildDatabaseUrlFromPgEnv({} as NodeJS.ProcessEnv), undefined);
});

test('buildDatabaseUrlFromPgEnv builds url with password and sslmode', () => {
  const env = {
    PGHOST: 'postgres.local',
    PGUSER: 'discord-user',
    PGDATABASE: 'discorddb',
    PGPORT: '6543',
    PGPASSWORD: 'pa$$word',
    PGSSLMODE: 'require'
  } as NodeJS.ProcessEnv;
  const url = buildDatabaseUrlFromPgEnv(env);
  assert.equal(url, 'postgresql://discord-user:pa%24%24word@postgres.local:6543/discorddb?sslmode=require');
});

test('buildDatabaseUrlFromPgEnv omits password and ssl by default', () => {
  const env = {
    PGHOST: 'db',
    PGUSER: 'user',
    PGDATABASE: 'discordbot'
  } as NodeJS.ProcessEnv;
  const url = buildDatabaseUrlFromPgEnv(env);
  assert.equal(url, 'postgresql://user@db:5432/discordbot');
});
