import { describe, expect, it } from 'vitest';
import { feedCountdownLabel } from './feedCountdown';

describe('feeding countdown', () => {
  it('formats hours, minutes, and seconds', () => {
    expect(feedCountdownLabel(2 * 60 * 60_000 + 10 * 60_000 + 5_000)).toBe('2:10:05');
  });

  it('rounds partial seconds up and supports overdue durations', () => {
    expect(feedCountdownLabel(1)).toBe('0:00:01');
    expect(feedCountdownLabel(-65_000)).toBe('0:01:05');
  });
});
