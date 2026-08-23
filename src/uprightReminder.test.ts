import { describe, expect, it } from 'vitest';
import { uprightReminderDelay } from './uprightReminder';

describe('in-app upright reminder timing', () => {
  const now = new Date('2026-08-22T12:00:00.000Z').getTime();

  it('fires 15 minutes after a new feed', () => {
    expect(uprightReminderDelay('2026-08-22T11:55:00.000Z', now)).toBe(10 * 60_000);
  });

  it('fires immediately when the app resumes shortly after it was due', () => {
    expect(uprightReminderDelay('2026-08-22T11:40:00.000Z', now)).toBe(0);
  });

  it('ignores stale and invalid feeds', () => {
    expect(uprightReminderDelay('2026-08-22T10:00:00.000Z', now)).toBeUndefined();
    expect(uprightReminderDelay('not-a-date', now)).toBeUndefined();
  });
});
