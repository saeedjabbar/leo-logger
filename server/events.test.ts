import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store.js';
import { canEditEvent, createEvent, validateEventDetails } from './events.js';
import type { BabyEvent, User } from './types.js';

const babyId = '11111111-1111-4111-8111-111111111111';
const user: User = { id: '22222222-2222-4222-8222-222222222222', role: 'caregiver', displayName: 'Grandma', allowedBabyIds: [babyId], defaultBabyId: babyId, active: true, createdAt: new Date().toISOString() };

describe('event validation and creation', () => {
  it('requires a feed amount', () => {
    expect(() => validateEventDetails({ babyId, type: 'feed', startAt: new Date().toISOString(), feed: { source: 'formula' } })).toThrow('Ounces are required');
  });

  it('validates a combo split against the total', () => {
    expect(() => validateEventDetails({ babyId, type: 'feed', startAt: new Date().toISOString(), feed: { source: 'combo', ounces: 3, formulaOunces: 1, breastMilkOunces: 1 } })).toThrow('must equal');
  });

  it('deduplicates retried client mutations', async () => {
    const store = new MemoryStore(); await store.initialize();
    const input = { babyId, type: 'diaper' as const, diaper: 'pee' as const, startAt: new Date().toISOString(), clientMutationId: 'offline-unique-id' };
    const first = await createEvent(store, input, user);
    const second = await createEvent(store, input, user);
    expect(second.id).toBe(first.id);
    expect(await store.list('events')).toHaveLength(1);
  });

  it('allows only one active sleep per baby', async () => {
    const store = new MemoryStore(); await store.initialize();
    const first = await createEvent(store, { babyId, type: 'sleep', startAt: new Date().toISOString() }, user);
    const second = await createEvent(store, { babyId, type: 'sleep', startAt: new Date().toISOString() }, user);
    expect(second.id).toBe(first.id);
  });

  it('allows caregivers to edit their own entries and admins to edit any entry', () => {
    const event = { babyId, createdBy: user.id } as BabyEvent;
    const otherCaregiver = { ...user, id: '33333333-3333-4333-8333-333333333333' };
    const admin = { ...otherCaregiver, role: 'admin' as const, allowedBabyIds: [] };
    expect(canEditEvent(user, event)).toBe(true);
    expect(canEditEvent(otherCaregiver, event)).toBe(false);
    expect(canEditEvent(admin, event)).toBe(true);
  });
});
