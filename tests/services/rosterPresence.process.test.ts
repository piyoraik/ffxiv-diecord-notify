import { strict as assert } from 'node:assert';
import test from 'node:test';
import { processRosterPresence, buildRosterUuid } from '../../src/services/rosterPresence.js';

const createFakePrisma = () => {
  const segments = new Map<string, any>();
  const roster: Array<{ guildId: string; name: string }> = [];
  const participants = new Map<string, string[]>();
  const presences: any[] = [];

  const prisma: any = {
    combatSegment: {
      findMany: async ({ where, take }: any) => {
        const result: any[] = [];
        const limitDate = where.windowStart?.gte ?? new Date(0);
        for (const seg of segments.values()) {
          if (seg.windowStart >= limitDate && !seg.presenceResolved) {
            result.push({ segmentId: seg.segmentId, windowStart: seg.windowStart, startTime: seg.startTime });
          }
        }
        result.sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
        return result.slice(0, take ?? result.length);
      },
      update: async ({ where, data }: any) => {
        const seg = segments.get(where.segmentId);
        if (seg) {
          Object.assign(seg, data);
        }
      }
    },
    roster: {
      findMany: async () => roster
    },
    segmentParticipant: {
      findMany: async ({ where }: any) => {
        return (participants.get(where.segmentId) ?? []).map(name => ({ playerName: name }));
      }
    },
    segmentPlayerStats: {
      findMany: async ({ where }: any) => {
        return (participants.get(where.segmentId) ?? []).map(name => ({ playerName: name }));
      }
    },
    segmentRosterPresence: {
      deleteMany: async ({ where }: any) => {
        for (let i = presences.length - 1; i >= 0; i--) {
          if (presences[i].segmentId === where.segmentId) {
            presences.splice(i, 1);
          }
        }
      },
      createMany: async ({ data }: any) => {
        presences.push(...data.map((d: any) => ({ ...d })));
      }
    },
    $transaction: async (fn: any) => {
      const tx = {
        segmentRosterPresence: prisma.segmentRosterPresence,
        combatSegment: prisma.combatSegment
      };
      return fn(tx);
    }
  };

  return { prisma, segments, roster, participants, presences };
};

test('processRosterPresence stores matches for roster', async () => {
  const { prisma, segments, roster, participants, presences } = createFakePrisma();
  const segmentId = 'seg-1';
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const startTime = new Date(now.getTime() - 50 * 60 * 1000);
  segments.set(segmentId, {
    segmentId,
    windowStart,
    startTime,
    presenceResolved: false
  });
  roster.push({ guildId: 'guild', name: 'Alice' }, { guildId: 'guild', name: 'Bob' });
  participants.set(segmentId, ['Alice']);

  const result = await processRosterPresence(prisma as any, { backfillHours: 24, maxSegments: 10 });
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  const segment = segments.get(segmentId);
  assert.ok(segment?.presenceResolved);
  assert.equal(presences.length, 2);
  const alice = presences.find(entry => entry.playerName === 'Alice');
  assert.ok(alice?.participated);
  assert.equal(alice?.matchedName, 'Alice');
  const bob = presences.find(entry => entry.playerName === 'Bob');
  assert.ok(bob);
  assert.equal(bob.participated, false);
  assert.equal(bob.matchedName, null);
  assert.equal(alice?.rosterId, buildRosterUuid('guild', 'Alice'));
});

test('processRosterPresence counts failures', async () => {
  const { prisma, segments, roster, participants } = createFakePrisma();
  const segmentId = 'seg-error';
  const now = new Date();
  const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const startTime = new Date(now.getTime() - 110 * 60 * 1000);
  segments.set(segmentId, {
    segmentId,
    windowStart,
    startTime,
    presenceResolved: false
  });
  roster.push({ guildId: 'guild', name: 'Alice' });
  participants.set(segmentId, ['Alice']);

  let shouldThrow = true;
  prisma.$transaction = async () => {
    if (shouldThrow) {
      shouldThrow = false;
      throw new Error('insert failed');
    }
  };

  const result = await processRosterPresence(prisma as any, { backfillHours: 24, maxSegments: 10 });
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  const segment = segments.get(segmentId);
  assert.ok(segment);
  assert.equal(segment?.presenceResolved, false);
});
