import { describe, expect, it } from 'vitest';
import { calculateInsights } from './analytics.js';
import type { BabyEvent } from './types.js';

const base = { babyId: 'baby', createdBy: 'parent', channel: 'pwa' as const, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' };
const events: BabyEvent[] = [
  { ...base, id: '1', type: 'feed', startAt: '2026-08-20T10:00:00.000Z', feed: { ounces: 2, source: 'formula' } },
  { ...base, id: '2', type: 'feed', startAt: '2026-08-20T13:00:00.000Z', feed: { ounces: 3, source: 'breast_milk' } },
  { ...base, id: '3', type: 'diaper', startAt: '2026-08-20T14:00:00.000Z', diaper: 'both' },
  { ...base, id: '4', type: 'sleep', startAt: '2026-08-20T15:00:00.000Z', endAt: '2026-08-20T17:30:00.000Z' },
];

describe('analytics', () => {
  it('calculates practical totals and intervals', () => {
    const result = calculateInsights(events, 'baby', new Date('2026-08-20'), new Date('2026-08-21'));
    expect(result.totals.ounces).toBe(5);
    expect(result.totals.wet).toBe(1);
    expect(result.totals.dirty).toBe(1);
    expect(result.totals.sleepHours).toBe(2.5);
    expect(result.feedIntervals.averageHours).toBe(3);
  });
});
