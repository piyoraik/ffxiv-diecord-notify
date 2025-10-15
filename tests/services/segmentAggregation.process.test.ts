import { strict as assert } from 'node:assert';
import test from 'node:test';
import { processPendingWindows } from '../../src/services/segmentAggregation.js';

const createFakePrisma = () => {
  const windows = new Map<number, any>();
  const combatSegments: any[] = [];
  const participants: any[] = [];
  const stats: any[] = [];
  const issues: any[] = [];

  const prisma: any = {
    aggregationWindow: {
      findFirst: async ({ where }: any) => {
        if (where?.status === 'pending') {
          const pending = Array.from(windows.values()).find(w => w.status === 'pending');
          return pending ? { ...pending } : null;
        }
        if (where?.status === undefined) {
          // used by ensureAggregationWindows but not in this test
          return null;
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        const window = windows.get(where.windowStart.getTime());
        if (window && window.status === where.status) {
          if (data.status) window.status = data.status;
          if (data.attempt?.increment) {
            window.attempt += data.attempt.increment;
          }
          window.updatedAt = data.updatedAt ?? window.updatedAt;
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async ({ where }: any) => {
        const window = windows.get(where.windowStart.getTime());
        return window ? { ...window } : null;
      },
      update: async ({ where, data }: any) => {
        const window = windows.get(where.windowStart.getTime());
        if (!window) {
          throw new Error('window not found');
        }
        Object.assign(window, data);
        return { ...window };
      }
    },
    $transaction: async (fn: any) => {
      const tx = {
        combatSegment: {
          deleteMany: async ({ where }: any) => {
            const start = where.windowStart.getTime();
            for (let i = combatSegments.length - 1; i >= 0; i--) {
              if (combatSegments[i].windowStart.getTime() === start) {
                combatSegments.splice(i, 1);
              }
            }
          },
          create: async ({ data }: any) => {
            combatSegments.push({ ...data });
          }
        },
        segmentParticipant: {
          createMany: async ({ data }: any) => {
            participants.push(...data.map((d: any) => ({ ...d })));
          }
        },
        segmentPlayerStats: {
          createMany: async ({ data }: any) => {
            stats.push(...data.map((d: any) => ({ ...d })));
          }
        },
        segmentIssue: {
          create: async ({ data }: any) => {
            issues.push({ ...data });
          }
        }
      };
      return fn(tx);
    }
  };

  return { prisma, windows, combatSegments, participants, stats, issues };
};

test('processPendingWindows succeeds and stores segments', async () => {
  const { prisma, windows, combatSegments, participants, stats, issues } = createFakePrisma();
  const windowStart = new Date('2025-10-10T12:00:00.000Z');
  windows.set(windowStart.getTime(), {
    windowStart,
    windowEnd: new Date('2025-10-10T13:00:00.000Z'),
    status: 'pending',
    attempt: 0,
    updatedAt: new Date(windowStart),
    lastError: null
  });

  const segments = [
    {
      id: 'seg-1',
      globalIndex: 1,
      ordinal: 1,
      content: 'Raid A',
      start: new Date('2025-10-10T12:10:00.000Z'),
      end: new Date('2025-10-10T12:30:00.000Z'),
      status: 'completed' as const,
      durationMs: 1200000,
      players: [
        {
          name: 'Alice',
          totalDamage: 100000,
          dps: 5000,
          hits: 20,
          criticalHits: 5,
          directHits: 3,
          jobCode: 'MNK',
          role: 'D'
        }
      ],
      participants: ['Alice']
    },
    {
      id: 'seg-2',
      globalIndex: 2,
      ordinal: 2,
      content: 'Raid B',
      start: new Date('2025-10-10T12:40:00.000Z'),
      end: null,
      status: 'missing_end' as const,
      durationMs: null,
      players: [],
      participants: []
    }
  ];

  const result = await processPendingWindows(prisma, { maxWindows: 1, bufferMs: 0 }, {
    analyzeLogs: async () => segments
  });

  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  const storedWindow = windows.get(windowStart.getTime());
  assert.ok(storedWindow);
  assert.equal(storedWindow?.status, 'succeeded');
  assert.equal(storedWindow?.attempt, 1);
  assert.equal(combatSegments.length, 2);
  assert.equal(participants.length, 1);
  assert.equal(stats.length, 1);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, 'missing_end');
});

test('processPendingWindows marks failure on error', async () => {
  const { prisma, windows } = createFakePrisma();
  const windowStart = new Date('2025-10-10T14:00:00.000Z');
  windows.set(windowStart.getTime(), {
    windowStart,
    windowEnd: new Date('2025-10-10T15:00:00.000Z'),
    status: 'pending',
    attempt: 0,
    updatedAt: new Date(windowStart),
    lastError: null
  });

  const result = await processPendingWindows(prisma, { maxWindows: 1, bufferMs: 0 }, {
    analyzeLogs: async () => {
      throw new Error('analyze failed');
    }
  });

  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  const storedWindow = windows.get(windowStart.getTime());
  assert.ok(storedWindow);
  assert.equal(storedWindow?.status, 'failed');
  assert.equal(storedWindow?.attempt, 1);
  assert.match(storedWindow?.lastError ?? '', /analyze failed/);
});
