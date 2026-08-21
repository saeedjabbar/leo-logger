import type { BabyEvent } from './types.js';

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateInsights(allEvents: BabyEvent[], babyId: string, from: Date, to: Date, timezone = 'UTC') {
  const events = allEvents
    .filter((event) => event.babyId === babyId && !event.deletedAt && new Date(event.startAt) >= from && new Date(event.startAt) <= to)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const feeds = events.filter((event) => event.type === 'feed');
  const sleeps = events.filter((event) => event.type === 'sleep');
  const intervals = feeds.slice(1).map((feed, index) => (new Date(feed.startAt).getTime() - new Date(feeds[index].startAt).getTime()) / 3_600_000);
  const hourCounts = Array.from({ length: 24 }, (_, hour) => ({ hour, feeds: 0, diapers: 0, sleeps: 0 }));
  const days = new Map<string, { date: string; ounces: number; feeds: number; wet: number; dirty: number; sleepHours: number }>();
  let formulaOunces = 0;
  let breastMilkOunces = 0;
  let comboOunces = 0;
  let wet = 0;
  let dirty = 0;
  let sleepHours = 0;
  let longestSleepHours = 0;

  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' });
  for (const event of events) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(event.startAt)).map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const day = days.get(date) || { date, ounces: 0, feeds: 0, wet: 0, dirty: 0, sleepHours: 0 };
    const hour = Number(parts.hour);
    if (event.type === 'feed') {
      const ounces = event.feed?.ounces || 0;
      day.ounces += ounces;
      day.feeds += 1;
      hourCounts[hour].feeds += 1;
      if (event.feed?.source === 'formula') formulaOunces += ounces;
      if (event.feed?.source === 'breast_milk') breastMilkOunces += ounces;
      if (event.feed?.source === 'combo') comboOunces += ounces;
    }
    if (event.type === 'diaper') {
      hourCounts[hour].diapers += 1;
      if (event.diaper === 'pee' || event.diaper === 'both') { wet += 1; day.wet += 1; }
      if (event.diaper === 'poop' || event.diaper === 'both') { dirty += 1; day.dirty += 1; }
    }
    if (event.type === 'sleep' && event.endAt) {
      const duration = (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 3_600_000;
      sleepHours += duration;
      day.sleepHours += duration;
      longestSleepHours = Math.max(longestSleepHours, duration);
      hourCounts[hour].sleeps += 1;
    }
    days.set(date, day);
  }

  const latest = (type: BabyEvent['type']) => [...events].reverse().find((event) => event.type === type);
  return {
    totals: { events: events.length, feeds: feeds.length, ounces: formulaOunces + breastMilkOunces + comboOunces, formulaOunces, breastMilkOunces, comboOunces, wet, dirty, sleeps: sleeps.length, sleepHours, longestSleepHours },
    feedIntervals: { averageHours: intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0, medianHours: median(intervals) },
    latest: { feed: latest('feed'), diaper: latest('diaper'), sleep: latest('sleep') },
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hourly: hourCounts,
  };
}
