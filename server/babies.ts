import { z } from 'zod';
import type { Baby, User } from './types.js';

const birthDateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Enter a valid birth date'),
  z.literal(''),
  z.null(),
]).transform((value) => value || undefined);

export const babyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  birthDate: birthDateSchema.optional(),
  timezone: z.string().trim().default('America/New_York'),
  feedingIntervalMinutes: z.number().int().min(15).max(720).default(120),
});

export const babyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  birthDate: birthDateSchema.optional(),
  timezone: z.string().trim().min(1).optional(),
  feedingIntervalMinutes: z.number().int().min(15).max(720).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one baby profile change');

export const scheduleUpdateSchema = z.object({
  feedingIntervalMinutes: z.number().int().min(15).max(720).optional(),
  uprightTimerEnabled: z.boolean().optional(),
}).refine((value) => value.feedingIntervalMinutes !== undefined || value.uprightTimerEnabled !== undefined, 'Provide at least one schedule change');

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function babyDeactivationError(babies: Baby[], users: User[], babyId: string) {
  const baby = babies.find((item) => item.id === babyId);
  if (!baby?.active) return undefined;
  if (babies.filter((item) => item.active).length <= 1) {
    return 'Add another baby before removing the final active baby';
  }
  const otherActiveIds = new Set(babies.filter((item) => item.active && item.id !== babyId).map((item) => item.id));
  // Admins have global access. Active caregivers only block removal when this
  // is their sole active assignment; otherwise stale assignments are cleaned.
  const stranded = users.filter((user) => user.role === 'caregiver' && user.active && user.allowedBabyIds.includes(babyId)
    && !user.allowedBabyIds.some((id) => otherActiveIds.has(id)));
  if (stranded.length) {
    const names = stranded.slice(0, 3).map((user) => user.displayName).join(', ');
    const extra = stranded.length > 3 ? ` and ${stranded.length - 3} more` : '';
    return `Give ${names}${extra} access to another baby before removing this baby`;
  }
  return undefined;
}

export function userUpdatesForBabyDeactivation(babies: Baby[], users: User[], babyId: string) {
  const otherActiveIds = babies.filter((item) => item.active && item.id !== babyId).map((item) => item.id);
  const activeSet = new Set(otherActiveIds);
  return users.flatMap((user) => {
    if (!user.allowedBabyIds.includes(babyId) && user.defaultBabyId !== babyId) return [];
    let allowedBabyIds = user.allowedBabyIds.filter((id) => id !== babyId);
    if (user.role === 'admin' && !allowedBabyIds.some((id) => activeSet.has(id)) && otherActiveIds[0]) {
      allowedBabyIds = [...allowedBabyIds, otherActiveIds[0]];
    }
    const defaultBabyId = user.defaultBabyId === babyId
      ? allowedBabyIds.find((id) => activeSet.has(id))
      : user.defaultBabyId;
    return [{ ...user, allowedBabyIds, defaultBabyId }];
  });
}
