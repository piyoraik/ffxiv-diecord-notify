import { fileURLToPath } from 'node:url';
import { getPrismaClient, closePrismaClient } from '../db/prisma.js';
import { processRosterPresence } from '../services/rosterPresence.js';

export const runRosterAggregationJob = async (options: { maxSegments?: number; guildIds?: string[] } = {}): Promise<void> => {
  const prisma = getPrismaClient();
  try {
    const guildIds = options.guildIds ?? (process.env.ROSTER_GUILD_IDS ? process.env.ROSTER_GUILD_IDS.split(',').map(id => id.trim()).filter(Boolean) : undefined);
    const maxSegments = options.maxSegments ?? (process.env.ROSTER_MAX_SEGMENTS ? Number(process.env.ROSTER_MAX_SEGMENTS) : undefined);
    const result = await processRosterPresence(prisma, {
      maxSegments: Number.isFinite(maxSegments) ? maxSegments : undefined,
      guildIds
    });
    console.log(`[roster-aggregation] processed=${result.processed} failed=${result.failed}`);
  } finally {
    await closePrismaClient();
  }
};

const run = async (): Promise<void> => {
  await runRosterAggregationJob();
};

const isMain = (() => {
  try {
    return typeof process.argv?.[1] === 'string' && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[roster-aggregation] job failed', error);
      process.exit(1);
    });
}
