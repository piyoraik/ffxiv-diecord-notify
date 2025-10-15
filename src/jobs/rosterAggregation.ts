import { fileURLToPath } from 'node:url';
import { getPrismaClient, closePrismaClient } from '../db/prisma.js';
import { processRosterPresence } from '../services/rosterPresence.js';
import { logError, logInfo } from '../utils/logger.js';

export const runRosterAggregationJob = async (options: { maxSegments?: number; guildIds?: string[] } = {}): Promise<void> => {
  const prisma = getPrismaClient();
  try {
    const guildIds = options.guildIds ?? (process.env.ROSTER_GUILD_IDS ? process.env.ROSTER_GUILD_IDS.split(',').map(id => id.trim()).filter(Boolean) : undefined);
    const maxSegments = options.maxSegments ?? (process.env.ROSTER_MAX_SEGMENTS ? Number(process.env.ROSTER_MAX_SEGMENTS) : undefined);
    logInfo('[roster-aggregation] job started', { maxSegments: maxSegments ?? null, guildIds: guildIds ?? null });
    const result = await processRosterPresence(prisma, {
      maxSegments: Number.isFinite(maxSegments) ? maxSegments : undefined,
      guildIds
    });
    logInfo('[roster-aggregation] job completed', result);
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
      logError('[roster-aggregation] job failed', undefined, error);
      process.exit(1);
    });
}
