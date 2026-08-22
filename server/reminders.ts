import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { Store } from './store.js';
import type { Baby, BabyEvent, PushSubscriptionRecord, ReminderState, User } from './types.js';

export function pushSubscriptionId(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('base64url');
}

export function remindersConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush() {
  if (!remindersConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return true;
}

export function nextFeedDueAt(events: BabyEvent[], baby: Baby) {
  const latest = events
    .filter((event) => event.babyId === baby.id && event.type === 'feed' && !event.deletedAt)
    .sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
  if (!latest) return undefined;
  const interval = baby.feedingIntervalMinutes || 120;
  return { latest, dueAt: new Date(new Date(latest.startAt).getTime() + interval * 60_000), marker: `${latest.id}:${latest.startAt}:${interval}` };
}

export function nextUprightDueAt(events: BabyEvent[], baby: Baby) {
  const latest = events
    .filter((event) => event.babyId === baby.id && event.type === 'feed' && !event.deletedAt)
    .sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
  if (!latest) return undefined;
  const minutes = 15;
  return { latest, minutes, dueAt: new Date(new Date(latest.startAt).getTime() + minutes * 60_000), marker: `${latest.id}:${latest.startAt}:${minutes}` };
}

export async function sendDueReminders(store: Store, now = new Date()) {
  if (!configureWebPush()) return { sent: 0, dueBabies: 0 };
  const [babies, events, subscriptions, users, states] = await Promise.all([
    store.list<Baby>('babies'), store.list<BabyEvent>('events'), store.list<PushSubscriptionRecord>('pushSubscriptions'),
    store.list<User>('users'), store.list<ReminderState>('reminderStates'),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const stateMap = new Map(states.map((state) => [state.babyId, state]));
  let sent = 0;
  let dueBabies = 0;

  for (const baby of babies.filter((item) => item.active)) {
    const schedule = nextFeedDueAt(events, baby);
    const state = stateMap.get(baby.id);
    const eligible = subscriptions.filter((subscription) => {
      const user = userMap.get(subscription.userId);
      return user?.active && (user.role === 'admin' || user.allowedBabyIds.includes(baby.id));
    });

    if (schedule && schedule.dueAt <= now && state?.feedMarker !== schedule.marker) {
      dueBabies += 1;
      const payload = JSON.stringify({
        title: `${baby.name}'s feeding is due`,
        body: `It has been ${Math.round((now.getTime() - new Date(schedule.latest.startAt).getTime()) / 60_000)} minutes since the last feed.`,
        url: '/', tag: `feed-due-${baby.id}`,
      });
      let delivered = 0;
      for (const subscription of eligible) {
        try {
          await webpush.sendNotification({ endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: subscription.keys }, payload, { TTL: 60 * 60, urgency: 'high' });
          delivered += 1; sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) await store.remove('pushSubscriptions', subscription.id);
          else console.error(JSON.stringify({ level: 'error', message: 'Feed reminder delivery failed', statusCode }));
        }
      }
      if (delivered) {
        const updated: ReminderState = { ...state, id: baby.id, babyId: baby.id, feedMarker: schedule.marker, notifiedAt: now.toISOString() };
        await store.put('reminderStates', updated.id, updated); stateMap.set(baby.id, updated);
      }
    }

    const upright = nextUprightDueAt(events, baby);
    const uprightIsTimely = upright && upright.dueAt <= now && now.getTime() - upright.dueAt.getTime() <= 30 * 60_000;
    const currentState = stateMap.get(baby.id);
    if (uprightIsTimely && currentState?.uprightMarker !== upright.marker) {
      const uprightEligible = eligible.filter((subscription) => userMap.get(subscription.userId)?.uprightTimerEnabled === true);
      const payload = JSON.stringify({
        title: `${baby.name}'s upright time is complete`,
        body: `${upright.minutes} minutes have passed since the last feed.`,
        url: '/', tag: `upright-complete-${baby.id}`,
      });
      let delivered = 0;
      for (const subscription of uprightEligible) {
        try {
          await webpush.sendNotification({ endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: subscription.keys }, payload, { TTL: 30 * 60, urgency: 'high' });
          delivered += 1; sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) await store.remove('pushSubscriptions', subscription.id);
          else console.error(JSON.stringify({ level: 'error', message: 'Upright timer delivery failed', statusCode }));
        }
      }
      if (delivered) {
        const updated: ReminderState = { ...currentState, id: baby.id, babyId: baby.id, uprightMarker: upright.marker, notifiedAt: now.toISOString() };
        await store.put('reminderStates', updated.id, updated); stateMap.set(baby.id, updated);
      }
    }
  }
  return { sent, dueBabies };
}

export function startReminderScheduler(store: Store) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await sendDueReminders(store); }
    catch (error) { console.error(JSON.stringify({ level: 'error', message: `Reminder scheduler failed: ${(error as Error).message}` })); }
    finally { running = false; }
  };
  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, 60_000);
  first.unref(); timer.unref();
}
