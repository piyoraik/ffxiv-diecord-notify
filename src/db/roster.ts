import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require('pg');

type RosterRow = {
  guild_id: string;
  name: string;
  job_code: string | null;
  emoji: string | null;
  discord_user_id: string | null;
};

let pool: any | null = null;

const getPool = (): any | null => {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL;
  const hasHost = process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE;
  try {
    if (databaseUrl) {
      pool = new Pool({ connectionString: databaseUrl, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
    } else if (hasHost) {
      pool = new Pool({
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE
      });
    } else {
      return null;
    }
    return pool;
  } catch {
    return null;
  }
};

export const ensureSchema = async (): Promise<void> => {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS roster (
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      job_code TEXT,
      emoji TEXT,
      discord_user_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (guild_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_roster_guild ON roster(guild_id);
  `);
};

export const upsertRoster = async (
  guildId: string,
  name: string,
  jobCode?: string,
  emoji?: string,
  discordUserId?: string
): Promise<void> => {
  const p = getPool();
  if (!p) return;
  await ensureSchema();
  await p.query(
    `INSERT INTO roster (guild_id, name, job_code, emoji, discord_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, name)
     DO UPDATE SET job_code = EXCLUDED.job_code, emoji = EXCLUDED.emoji, discord_user_id = EXCLUDED.discord_user_id, updated_at = now()`,
    [guildId, name, jobCode ?? null, emoji ?? null, discordUserId ?? null]
  );
};

export const deleteRoster = async (guildId: string, name: string): Promise<void> => {
  const p = getPool();
  if (!p) return;
  await ensureSchema();
  await p.query(`DELETE FROM roster WHERE guild_id = $1 AND name = $2`, [guildId, name]);
};

export const listRoster = async (guildId: string): Promise<Array<{ name: string; jobCode?: string | null; emoji?: string | null }>> => {
  const p = getPool();
  if (!p) return [];
  await ensureSchema();
  const res = await p.query(`SELECT name, job_code, emoji FROM roster WHERE guild_id = $1 ORDER BY name`, [guildId]);
  return (res.rows as RosterRow[]).map(r => ({ name: r.name, jobCode: r.job_code, emoji: r.emoji }));
};

