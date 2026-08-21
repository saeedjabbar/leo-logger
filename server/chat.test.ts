import { describe, expect, it } from 'vitest';
import { interpretFallback } from './chat.js';
import type { Baby } from './types.js';

const baby: Baby = { id: 'leo', name: 'Leo', timezone: 'America/New_York', feedingIntervalMinutes: 120, active: true, createdAt: '2026-08-01T00:00:00.000Z' };
const now = new Date('2026-08-21T09:00:00.000Z');

describe('built-in natural language logger', () => {
  it('parses a feed amount and local time', () => {
    const result = interpretFallback('I fed him 2oz at 2:10am', baby, now);
    expect(result.events[0]).toMatchObject({ type: 'feed', ounces: 2, source: 'formula', startAt: '2026-08-21T06:10:00.000Z' });
  });

  it('parses relative diaper activity', () => {
    const result = interpretFallback('He peed 10 minutes ago', baby, now);
    expect(result.events[0]).toMatchObject({ type: 'diaper', diaper: 'pee', startAt: '2026-08-21T08:50:00.000Z' });
  });

  it('asks for required feed information instead of inventing it', () => {
    const result = interpretFallback('I fed him at 2am', baby, now);
    expect(result.clarificationNeeded).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});
