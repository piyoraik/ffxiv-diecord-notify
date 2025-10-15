import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from './prisma.js';
import { appSettings } from '../config.js';
import { determineTimeWindow } from '../services/combatAnalyzer.js';
import { type CombatSegmentSummary, type DailyCombatSummary, type ActivityStatus } from '../types/combat.js';
import type { Role } from '../jobs.js';

const prisma: PrismaClient = getPrismaClient();

const TIME_ZONE = appSettings.timeZone();
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const decimalToNumber = (value: Prisma.Decimal | string): number => Number(value);
const bigintToNumber = (value: bigint): number => Number(value);

const mapSegments = (rows: Array<{
  segmentId: string;
  content: string;
  startTime: Date | null;
  endTime: Date | null;
  status: string;
  durationMs: number | null;
  ordinal: number;
  windowStart: Date;
  presenceResolved: boolean;
  playerStats: Array<{
    playerName: string;
    totalDamage: bigint;
    dps: Prisma.Decimal;
    hits: number;
    criticalHits: number;
    directHits: number;
    jobCode: string | null;
    role: string | null;
  }>;
  participants: Array<{ playerName: string }>;
}>): CombatSegmentSummary[] => {
  return rows
    .map((row, index) => {
      const players = [...row.playerStats]
        .sort((a, b) => bigintToNumber(b.totalDamage) - bigintToNumber(a.totalDamage))
        .map(player => ({
          name: player.playerName,
          totalDamage: bigintToNumber(player.totalDamage),
          dps: decimalToNumber(player.dps),
          hits: player.hits,
          criticalHits: player.criticalHits,
          directHits: player.directHits,
          jobCode: player.jobCode ?? undefined,
          role: (player.role ?? undefined) as Role | undefined
        }));

      const participantNames = new Set<string>();
      row.participants.forEach(p => participantNames.add(p.playerName));

      return {
        id: row.segmentId,
        globalIndex: index + 1,
        ordinal: row.ordinal,
        content: row.content,
        start: row.startTime,
        end: row.endTime,
        status: row.status as ActivityStatus,
        durationMs: row.durationMs,
        players,
        participants: Array.from(participantNames),
        presenceResolved: row.presenceResolved
      } satisfies CombatSegmentSummary;
    })
    .sort((a, b) => {
      const aTime = a.start?.getTime() ?? 0;
      const bTime = b.start?.getTime() ?? 0;
      return aTime - bTime;
    })
    .map((segment, index) => ({
      ...segment,
      globalIndex: index + 1
    }));
};

const fetchAvailableDates = async (): Promise<string[]> => {
  const windows = await prisma.aggregationWindow.findMany({
    where: { status: 'succeeded' },
    orderBy: { windowStart: 'desc' },
    take: 60,
    select: { windowStart: true }
  });
  const unique = new Set<string>();
  for (const win of windows) {
    unique.add(dateFormatter.format(win.windowStart));
  }
  return Array.from(unique).sort();
};

export const fetchDailySummaryFromDb = async (requestedDate?: string): Promise<DailyCombatSummary> => {
  const { targetDate, startDate, endDate } = determineTimeWindow(requestedDate);

  const segments = await prisma.combatSegment.findMany({
    where: {
      windowStart: {
        gte: startDate,
        lt: endDate
      }
    },
    orderBy: [{ windowStart: 'asc' }, { startTime: 'asc' }, { segmentId: 'asc' }],
    include: {
      playerStats: true,
      participants: true
    }
  });

  const summaries = mapSegments(segments);
  const availableDates = await fetchAvailableDates();
  if (!availableDates.includes(targetDate)) {
    availableDates.push(targetDate);
  }
  availableDates.sort();

  return {
    date: targetDate,
    segments: summaries,
    availableDates
  } satisfies DailyCombatSummary;
};
