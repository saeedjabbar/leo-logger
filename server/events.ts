import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BabyEvent, EventRevision, User } from './types.js';
import type { Store } from './store.js';

export const eventInputSchema = z.object({
  id: z.string().uuid().optional(),
  clientMutationId: z.string().min(8).max(100).optional(),
  babyId: z.string().uuid(),
  type: z.enum(['feed', 'diaper', 'sleep', 'legacy_pump']),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime().optional(),
  feed: z.object({
    ounces: z.number().min(0).max(64).optional(),
    source: z.enum(['formula', 'breast_milk', 'combo']),
    formulaOunces: z.number().min(0).max(64).optional(),
    breastMilkOunces: z.number().min(0).max(64).optional(),
  }).optional(),
  diaper: z.enum(['pee', 'poop', 'both']).optional(),
  notes: z.string().max(500).optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export function validateEventDetails(input: EventInput) {
  if (input.type === 'feed') {
    if (!input.feed) throw new Error('Feed details are required');
    if (input.feed.ounces === undefined) throw new Error('Ounces are required');
    if (input.feed.source === 'combo' && (input.feed.formulaOunces !== undefined || input.feed.breastMilkOunces !== undefined)) {
      const sum = (input.feed.formulaOunces || 0) + (input.feed.breastMilkOunces || 0);
      if (Math.abs(sum - input.feed.ounces) > 0.001) throw new Error('Formula and breast milk amounts must equal total ounces');
    }
  }
  if (input.type === 'diaper' && !input.diaper) throw new Error('Diaper type is required');
  if (input.type === 'sleep' && input.endAt && new Date(input.endAt) <= new Date(input.startAt)) throw new Error('Wake time must be after sleep time');
}

export function canAccessBaby(user: User, babyId: string) {
  return user.role === 'admin' || user.allowedBabyIds.includes(babyId);
}

export async function createEvent(store: Store, input: EventInput, actor: User, channel: BabyEvent['channel'] = 'pwa') {
  validateEventDetails(input);
  if (!canAccessBaby(actor, input.babyId)) throw new Error('You do not have access to that baby');

  if (input.clientMutationId) {
    const existing = (await store.list<BabyEvent>('events')).find((event) => event.clientMutationId === input.clientMutationId);
    if (existing) return existing;
  }

  if (input.type === 'sleep' && !input.endAt) {
    const active = (await store.list<BabyEvent>('events')).find((event) => event.babyId === input.babyId && event.type === 'sleep' && !event.endAt && !event.deletedAt);
    if (active) return active;
  }

  const now = new Date().toISOString();
  const event: BabyEvent = {
    ...input,
    id: input.id || randomUUID(),
    createdBy: actor.id,
    channel,
    createdAt: now,
    updatedAt: now,
  };
  await store.put('events', event.id, event);
  return event;
}

export async function reviseEvent(store: Store, event: BabyEvent, actor: User, action: EventRevision['action']) {
  const revision: EventRevision = {
    id: randomUUID(),
    eventId: event.id,
    actorId: actor.id,
    action,
    snapshot: event,
    createdAt: new Date().toISOString(),
  };
  await store.put('revisions', revision.id, revision);
}
