import { fileURLToPath } from 'node:url';
import { getPrismaClient, closePrismaClient } from '../db/prisma.js';
import { ensureAggregationWindows, processPendingWindows } from '../services/segmentAggregation.js';
import { logError, logInfo } from '../utils/logger.js';

export const runSegmentAggregationJob = async (maxWindows?: number): Promise<void> => {
  const prisma = getPrismaClient();
  try {
    logInfo('[segment-aggregation] job started', { maxWindows: maxWindows ?? null });
    await ensureAggregationWindows(prisma);
    const { processed, failed } = await processPendingWindows(prisma, {
      maxWindows
    });
    logInfo('[segment-aggregation] job completed', { processed, failed });
  } finally {
    await closePrismaClient();
  }
};

const run = async (): Promise<void> => {
  const maxWindows = process.env.AGGREGATION_MAX_WINDOWS ? Number(process.env.AGGREGATION_MAX_WINDOWS) : undefined;
  await runSegmentAggregationJob(Number.isFinite(maxWindows) ? maxWindows : undefined);
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
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      logError('[segment-aggregation] job failed', undefined, error);
      process.exit(1);
    });
}
