import { describe, expect, it } from 'vitest';
import { babyCreateSchema, babyDeactivationError, babyUpdateSchema, isValidTimezone, scheduleUpdateSchema, userUpdatesForBabyDeactivation } from './babies.js';
import type { Baby, User } from './types.js';

const babies: Baby[] = [
  { id: 'leo', name: 'Leo', timezone: 'America/New_York', feedingIntervalMinutes: 120, active: true, createdAt: '2026-08-01T00:00:00.000Z' },
  { id: 'mia', name: 'Mia', timezone: 'America/New_York', feedingIntervalMinutes: 180, active: true, createdAt: '2026-08-01T00:00:00.000Z' },
];
const caregiver: User = { id: 'grandma', role: 'caregiver', displayName: 'Grandma', allowedBabyIds: ['leo'], defaultBabyId: 'leo', active: true, createdAt: '2026-08-01T00:00:00.000Z' };

describe('baby profile validation', () => {
  it('normalizes names and allows clearing a birth date', () => {
    expect(babyCreateSchema.parse({ name: '  Leo  ' }).name).toBe('Leo');
    expect(babyUpdateSchema.parse({ birthDate: null }).birthDate).toBeUndefined();
  });

  it('rejects invalid calendar dates and feeding intervals', () => {
    expect(babyUpdateSchema.safeParse({ birthDate: '2026-02-30' }).success).toBe(false);
    expect(scheduleUpdateSchema.safeParse({ feedingIntervalMinutes: 14 }).success).toBe(false);
    expect(scheduleUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('validates IANA timezones', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/A_Timezone')).toBe(false);
  });
});

describe('baby deactivation safety', () => {
  it('blocks removing the final active baby', () => {
    expect(babyDeactivationError([babies[0]], [], 'leo')).toMatch(/final active baby/);
  });

  it('blocks removing a caregiver\'s only active baby', () => {
    expect(babyDeactivationError(babies, [caregiver], 'leo')).toContain('Grandma');
  });

  it('allows removal after caregivers are reassigned', () => {
    expect(babyDeactivationError(babies, [{ ...caregiver, allowedBabyIds: ['leo', 'mia'] }], 'leo')).toBeUndefined();
  });

  it('does not treat an admin global-access list as a caregiver assignment', () => {
    expect(babyDeactivationError(babies, [{ ...caregiver, role: 'admin' }], 'leo')).toBeUndefined();
  });

  it('does not let disabled caregivers strand deactivation', () => {
    expect(babyDeactivationError(babies, [{ ...caregiver, active: false }], 'leo')).toBeUndefined();
  });

  it('cleans access and moves defaults to another active baby', () => {
    const [updated] = userUpdatesForBabyDeactivation(babies, [{ ...caregiver, allowedBabyIds: ['leo', 'mia'] }], 'leo');
    expect(updated.allowedBabyIds).toEqual(['mia']);
    expect(updated.defaultBabyId).toBe('mia');
  });

  it('keeps an admin usable when the removed baby was their legacy assignment', () => {
    const [updated] = userUpdatesForBabyDeactivation(babies, [{ ...caregiver, role: 'admin' }], 'leo');
    expect(updated.allowedBabyIds).toEqual(['mia']);
    expect(updated.defaultBabyId).toBe('mia');
  });
});
