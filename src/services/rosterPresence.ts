import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { logDebug, logError, logInfo, logWarn } from '../utils/logger.js';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_BACKFILL_HOURS = Number(process.env.ROSTER_BACKFILL_HOURS ?? '6');
const DEFAULT_MAX_SEGMENTS = Number(process.env.ROSTER_MAX_SEGMENTS ?? '20');

const canonicalizeName = (name: string): string => name.trim().toLowerCase();

export const buildRosterUuid = (guildId: string, name: string): string => {
  const hash = createHash('sha1')
    .update(guildId)
    .update('|')
    .update(name)
    .digest('hex');
  const normalized = hash.slice(0, 32).padEnd(32, '0');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
};

interface PresenceOptions {
  backfillHours?: number;
  maxSegments?: number;
  guildIds?: string[];
}

const buildRosterWhere = (guildIds?: string[]) => {
  if (!guildIds || guildIds.length === 0) {
    return undefined;
  }
  return {
    guildId: {
      in: guildIds
    }
  };
};

const pickOriginName = (names: string[], canonicalMap: Map<string, string>): string | null => {
  for (const name of names) {
    const key = canonicalizeName(name);
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, name);
    }
  }
  return null;
};

const collectParticipantNames = async (prisma: PrismaClient, segmentId: string): Promise<Map<string, string>> => {
  const canonical = new Map<string, string>();
  const canonicalSet = new Set<string>();
  const participants = await prisma.segmentParticipant.findMany({
    where: { segmentId },
    select: { playerName: true }
  });
  for (const participant of participants) {
    const key = canonicalizeName(participant.playerName);
    if (!canonicalSet.has(key)) {
      canonical.set(key, participant.playerName);
      canonicalSet.add(key);
    }
  }
  if (canonical.size === 0) {
    const stats = await prisma.segmentPlayerStats.findMany({
      where: { segmentId },
      select: { playerName: true }
    });
    for (const stat of stats) {
      const key = canonicalizeName(stat.playerName);
      if (!canonicalSet.has(key)) {
        canonical.set(key, stat.playerName);
        canonicalSet.add(key);
      }
    }
  }
  return canonical;
};

const createPresenceEntries = (
  segmentId: string,
  participantMap: Map<string, string>,
  roster: Array<{ guildId: string; name: string }>
) => {
  return roster.map(member => {
    const key = canonicalizeName(member.name);
    const matched = participantMap.get(key) ?? null;
    return {
      segmentId,
      rosterId: buildRosterUuid(member.guildId, member.name),
      playerName: member.name,
      matchedName: matched,
      matchScore: matched ? '1' : '0',
      participated: Boolean(matched),
      updatedAt: new Date()
    };
  });
};

export const processRosterPresence = async (
  prisma: PrismaClient,
  options: PresenceOptions = {}
): Promise<{ processed: number; failed: number }> => {
  const backfillHours = options.backfillHours ?? DEFAULT_BACKFILL_HOURS;
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const guildIds = options.guildIds?.map(id => id.trim()).filter(Boolean);

  const limitDate = new Date(Date.now() - backfillHours * HOUR_MS);

  const segments = await prisma.combatSegment.findMany({
    where: {
      presenceResolved: false,
      windowStart: { gte: limitDate }
    },
    orderBy: { windowStart: 'asc' },
    take: maxSegments,
    select: {
      segmentId: true,
      windowStart: true,
      startTime: true
    }
  });

  if (segments.length === 0) {
    logDebug('[roster-aggregation] no segments pending', { limitDate: limitDate.toISOString() });
    return { processed: 0, failed: 0 };
  }

  const rosterMembers = await prisma.roster.findMany({
    where: buildRosterWhere(guildIds),
    select: { guildId: true, name: true }
  });

  const usedRoster = rosterMembers.length > 0 ? rosterMembers : [];
  logInfo('[roster-aggregation] processing segments', {
    segmentCount: segments.length,
    rosterCount: usedRoster.length,
    guildFilter: guildIds ?? null
  });
  if (usedRoster.length === 0) {
    logWarn('[roster-aggregation] roster empty', { guildFilter: guildIds ?? null });
  }
  const now = new Date();
  let processed = 0;
  let failed = 0;

  for (const segment of segments) {
    try {
      const participantMap = await collectParticipantNames(prisma, segment.segmentId);
      const entries = usedRoster.length > 0 ? createPresenceEntries(segment.segmentId, participantMap, usedRoster) : [];

      await prisma.$transaction(async tx => {
        await tx.segmentRosterPresence.deleteMany({ where: { segmentId: segment.segmentId } });
        if (entries.length > 0) {
          await tx.segmentRosterPresence.createMany({ data: entries });
        }
        await tx.combatSegment.update({
          where: { segmentId: segment.segmentId },
          data: {
            presenceResolved: true,
            updatedAt: now
          }
        });
      });
      logDebug('[roster-aggregation] segment resolved', {
        segmentId: segment.segmentId,
        entries: entries.length
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[roster-aggregation] failed to process segment', { segmentId: segment.segmentId, error: message });
      try {
        await prisma.combatSegment.update({
          where: { segmentId: segment.segmentId },
          data: {
            presenceResolved: false,
            updatedAt: new Date()
          }
        });
      } catch {
        // ignore secondary update failures
      }
    }
  }

  logInfo('[roster-aggregation] summary', { processed, failed });
  return { processed, failed };
};
