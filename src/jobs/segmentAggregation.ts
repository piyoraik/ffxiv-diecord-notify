import { fileURLToPath } from 'node:url';
import { getPrismaClient, closePrismaClient } from '../db/prisma.js';
import { ensureAggregationWindows, processPendingWindows } from '../services/segmentAggregation.js';

export const runSegmentAggregationJob = async (maxWindows?: number): Promise<void> => {
  const prisma = getPrismaClient();
  try {
    await ensureAggregationWindows(prisma);
    const { processed, failed } = await processPendingWindows(prisma, {
      maxWindows
    });
    console.log(`[segment-aggregation] processed=${processed} failed=${failed}`);
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
      console.error('[segment-aggregation] job failed', error);
      process.exit(1);
    });
}
