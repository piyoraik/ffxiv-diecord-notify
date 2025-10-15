import { createHash } from 'node:crypto';
import { PrismaClient, AggregationWindow } from '@prisma/client';
import { analyzeLogsBetween } from './combatAnalyzer.js';
import { logDebug, logError, logInfo } from '../utils/logger.js';

const HOUR_MS = 60 * 60 * 1000;
const BUFFER_MS = 15 * 60 * 1000;
const DEFAULT_BACKFILL_HOURS = Number(process.env.AGGREGATION_BACKFILL_HOURS ?? '6');
const MAX_ERROR_LENGTH = 500;

export const floorToHour = (date: Date): Date => {
  const ms = Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;
  return new Date(ms);
};

const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * HOUR_MS);

export const deriveSegmentUuid = (windowStart: Date, segmentId: string, content: string): string => {
  const hash = createHash('sha1')
    .update(windowStart.toISOString())
    .update('|')
    .update(segmentId)
    .update('|')
    .update(content)
    .digest('hex');
  const normalized = hash.slice(0, 32).padEnd(32, '0');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
};

const buildWindowRange = (limitStart: Date, backfillHours: number, latest?: Date | null): Date[] => {
  const windows: Date[] = [];
  const startingPoint = latest ? addHours(latest, 1) : addHours(limitStart, -backfillHours + 1);
  let cursor = floorToHour(startingPoint);
  while (cursor <= limitStart) {
    windows.push(cursor);
    cursor = addHours(cursor, 1);
  }
  return windows;
};

export const ensureAggregationWindows = async (
  prisma: PrismaClient,
  options: { backfillHours?: number; bufferMs?: number } = {}
): Promise<void> => {
  const backfillHours = options.backfillHours ?? DEFAULT_BACKFILL_HOURS;
  const bufferMs = options.bufferMs ?? BUFFER_MS;
  const now = new Date();
  const limitStart = floorToHour(new Date(now.getTime() - bufferMs));
  if (limitStart.getTime() < 0) {
    return;
  }

  const latestWindow = await prisma.aggregationWindow.findFirst({
    orderBy: { windowStart: 'desc' }
  });

  const windowsToCreate = buildWindowRange(limitStart, backfillHours, latestWindow?.windowStart ?? null);
  if (windowsToCreate.length === 0) {
    logDebug('[segment-aggregation] no new windows', { limitStart: limitStart.toISOString() });
    return;
  }

  const operations = windowsToCreate.map(windowStart => {
    const windowEnd = addHours(windowStart, 1);
    return prisma.aggregationWindow.upsert({
      where: { windowStart },
      update: {},
      create: {
        windowStart,
        windowEnd,
        status: 'pending',
        attempt: 0,
        updatedAt: new Date()
      }
    });
  });
  await Promise.all(operations);
  logInfo('[segment-aggregation] windows ensured', {
    created: windowsToCreate.length,
    firstWindow: windowsToCreate[0]?.toISOString(),
    lastWindow: windowsToCreate[windowsToCreate.length - 1]?.toISOString()
  });
};

const acquirePendingWindow = async (prisma: PrismaClient): Promise<AggregationWindow | null> => {
  while (true) {
    const pending = await prisma.aggregationWindow.findFirst({
      where: { status: 'pending' },
      orderBy: { windowStart: 'asc' }
    });
    if (!pending) {
      return null;
    }
    const result = await prisma.aggregationWindow.updateMany({
      where: { windowStart: pending.windowStart, status: 'pending' },
      data: { status: 'in_progress', attempt: { increment: 1 }, updatedAt: new Date() }
    });
    if (result.count > 0) {
      return prisma.aggregationWindow.findUnique({ where: { windowStart: pending.windowStart } });
    }
  }
};

type AnalyzedSegments = Awaited<ReturnType<typeof analyzeLogsBetween>>;

const toBigInt = (value: number): bigint => {
  if (!Number.isFinite(value)) {
    return BigInt(0);
  }
  return BigInt(Math.max(0, Math.round(value)));
};

const toDecimalString = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toFixed(2);
};

const persistSegments = async (
  prisma: PrismaClient,
  windowStart: Date,
  segments: AnalyzedSegments
): Promise<void> => {
  await prisma.$transaction(async tx => {
    await tx.combatSegment.deleteMany({ where: { windowStart } });
  
    for (const seg of segments) {
      const candidateStart = seg.start ?? seg.end ?? windowStart;
      const segmentStart = candidateStart ?? windowStart;
      const segmentEnd = seg.end ?? null;
      const segmentId = deriveSegmentUuid(windowStart, seg.id, seg.content);
      await tx.combatSegment.create({
        data: {
          segmentId,
          windowStart,
          content: seg.content,
          startTime: segmentStart,
          endTime: segmentEnd,
          ordinal: seg.ordinal,
          status: seg.status,
          durationMs: seg.durationMs ?? null,
          presenceResolved: false
        }
      });

      const participantNames = seg.participants ? Array.from(new Set(seg.participants)) : [];
      if (participantNames.length > 0) {
        const data = participantNames.map(name => {
          const player = seg.players.find(p => p.name === name);
          return {
            segmentId,
            playerName: name,
            jobCode: player?.jobCode ?? null,
            role: player?.role ?? null,
            source: 'aggregate'
          };
        });
        await tx.segmentParticipant.createMany({ data });
      }

      if (seg.players.length > 0) {
        const stats = seg.players.map(player => ({
          segmentId,
          playerName: player.name,
          totalDamage: toBigInt(player.totalDamage),
          dps: toDecimalString(player.dps),
          hits: player.hits,
          criticalHits: player.criticalHits,
          directHits: player.directHits,
          jobCode: player.jobCode ?? null,
          role: player.role ?? null
        }));
        await tx.segmentPlayerStats.createMany({ data: stats });
      }

      if (seg.status !== 'completed') {
        await tx.segmentIssue.create({
          data: {
            segmentId,
            issueType: seg.status,
            detail: null
          }
        });
      }
    }
  });
};

const filterSegmentsForWindow = (windowStart: Date, windowEnd: Date, segments: AnalyzedSegments) => {
  return segments.filter(seg => {
    const reference = seg.start ?? seg.end;
    if (!reference) {
      return false;
    }
    return reference >= windowStart && reference < windowEnd;
  });
};

const processWindow = async (
  prisma: PrismaClient,
  window: AggregationWindow,
  bufferMs: number,
  analyzeLogs: typeof analyzeLogsBetween
): Promise<void> => {
  const windowStart = new Date(window.windowStart);
  const windowEnd = new Date(window.windowEnd);
  const fetchEnd = new Date(windowEnd.getTime() + bufferMs);
  logDebug('[segment-aggregation] start window processing', {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    fetchEnd: fetchEnd.toISOString()
  });
  const segments = await analyzeLogs(windowStart, fetchEnd);
  const filtered = filterSegmentsForWindow(windowStart, windowEnd, segments);
  await persistSegments(prisma, windowStart, filtered);
  logDebug('[segment-aggregation] window persisted', {
    windowStart: windowStart.toISOString(),
    segmentCount: filtered.length
  });
};

export const processPendingWindows = async (
  prisma: PrismaClient,
  options: { maxWindows?: number; bufferMs?: number } = {},
  deps: { analyzeLogs?: typeof analyzeLogsBetween } = {}
): Promise<{ processed: number; failed: number }> => {
  const maxWindows = options.maxWindows ?? Number.POSITIVE_INFINITY;
  const bufferMs = options.bufferMs ?? BUFFER_MS;
  const analyzeLogs = deps.analyzeLogs ?? analyzeLogsBetween;
  let processed = 0;
  let failed = 0;

  while (processed + failed < maxWindows) {
    const window = await acquirePendingWindow(prisma);
    if (!window) {
      logDebug('[segment-aggregation] no pending windows to process');
      break;
    }

    try {
      await processWindow(prisma, window, bufferMs, analyzeLogs);
      await prisma.aggregationWindow.update({
        where: { windowStart: window.windowStart },
        data: {
          status: 'succeeded',
          updatedAt: new Date(),
          lastError: null
        }
      });
      logInfo('[segment-aggregation] window succeeded', {
        windowStart: window.windowStart.toISOString(),
        attempt: window.attempt + 1
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.aggregationWindow.update({
        where: { windowStart: window.windowStart },
        data: {
          status: 'failed',
          updatedAt: new Date(),
          lastError: message.slice(0, MAX_ERROR_LENGTH)
        }
      });
      logError('[segment-aggregation] window failed', {
        windowStart: window.windowStart.toISOString(),
        attempt: window.attempt + 1
      }, error);
      failed += 1;
    }
  }

  return { processed, failed };
};
