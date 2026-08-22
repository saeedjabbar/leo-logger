import { describe, expect, it } from 'vitest';
import { nextFeedDueAt, nextUprightDueAt, pushSubscriptionId } from './reminders.js';
import type { Baby, BabyEvent } from './types.js';

const baby: Baby = { id: 'baby', name: 'Leo', timezone: 'America/New_York', feedingIntervalMinutes: 120, active: true, createdAt: '2026-08-21T00:00:00.000Z' };
const base = { babyId: baby.id, createdBy: 'parent', channel: 'pwa' as const, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z' };

describe('feeding reminders', () => {
  it('uses the most recent feed and the configured interval', () => {
    const events: BabyEvent[] = [
      { ...base, id: 'old', type: 'feed', startAt: '2026-08-21T01:00:00.000Z', feed: { ounces: 1, source: 'formula' } },
      { ...base, id: 'latest', type: 'feed', startAt: '2026-08-21T03:20:00.000Z', feed: { ounces: 2, source: 'formula' } },
    ];
    expect(nextFeedDueAt(events, baby)?.dueAt.toISOString()).toBe('2026-08-21T05:20:00.000Z');
  });

  it('creates stable, opaque subscription identifiers', () => {
    expect(pushSubscriptionId('https://push.example/subscription')).toBe(pushSubscriptionId('https://push.example/subscription'));
    expect(pushSubscriptionId('https://push.example/subscription')).not.toContain('push.example');
  });

  it('sets the upright timer for 15 minutes after the latest feed', () => {
    const events: BabyEvent[] = [
      { ...base, id: 'latest', type: 'feed', startAt: '2026-08-21T03:20:00.000Z', feed: { ounces: 2, source: 'formula' } },
    ];
    expect(nextUprightDueAt(events, baby)?.dueAt.toISOString()).toBe('2026-08-21T03:35:00.000Z');
  });
});
