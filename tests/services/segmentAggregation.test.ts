import { strict as assert } from 'node:assert';
import test from 'node:test';
import { deriveSegmentUuid, floorToHour } from '../../src/services/segmentAggregation.js';

test('floorToHour truncates to hour', () => {
  const date = new Date('2025-10-10T12:34:56.789Z');
  const floored = floorToHour(date);
  assert.equal(floored.toISOString(), '2025-10-10T12:00:00.000Z');
});

test('deriveSegmentUuid is deterministic', () => {
  const windowStart = new Date('2025-10-10T12:00:00.000Z');
  const uuid1 = deriveSegmentUuid(windowStart, 'segment-1', 'content');
  const uuid2 = deriveSegmentUuid(windowStart, 'segment-1', 'content');
  assert.equal(uuid1, uuid2);
  const uuid3 = deriveSegmentUuid(windowStart, 'segment-2', 'content');
  assert.notEqual(uuid1, uuid3);
});
