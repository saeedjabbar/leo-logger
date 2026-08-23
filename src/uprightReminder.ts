export const UPRIGHT_MINUTES = 15;
const recentWindow = 45 * 60_000;

export function uprightReminderDelay(feedStartAt: string, now = Date.now()) {
  const feedAt = new Date(feedStartAt).getTime();
  if (!Number.isFinite(feedAt)) return undefined;
  const delay = feedAt + UPRIGHT_MINUTES * 60_000 - now;
  if (delay < -recentWindow) return undefined;
  return Math.max(0, delay);
}
