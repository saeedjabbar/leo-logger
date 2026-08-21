export type Role = 'master_admin' | 'caregiver';
export interface User { id: string; role: Role; displayName: string; email?: string; allowedBabyIds: string[]; defaultBabyId?: string; mustChangePassword?: boolean; active: boolean }
export interface Baby { id: string; name: string; birthDate?: string; timezone: string; feedingIntervalMinutes: number; active: boolean }
export interface BabyEvent {
  id: string; babyId: string; type: 'feed' | 'diaper' | 'sleep' | 'legacy_pump'; startAt: string; endAt?: string;
  feed?: { ounces?: number; source: 'formula' | 'breast_milk' | 'combo'; formulaOunces?: number; breastMilkOunces?: number };
  diaper?: 'pee' | 'poop' | 'both'; notes?: string; createdBy: string; channel: 'pwa' | 'alexa' | 'import';
  createdAt: string; updatedAt: string; importWarnings?: string[];
}
export interface MeResponse { user: User; babies: Baby[]; activeSleep?: BabyEvent }
export interface Insights {
  totals: { events: number; feeds: number; ounces: number; formulaOunces: number; breastMilkOunces: number; comboOunces: number; wet: number; dirty: number; sleeps: number; sleepHours: number; longestSleepHours: number };
  feedIntervals: { averageHours: number; medianHours: number };
  latest: { feed?: BabyEvent; diaper?: BabyEvent; sleep?: BabyEvent };
  daily: { date: string; ounces: number; feeds: number; wet: number; dirty: number; sleepHours: number }[];
  hourly: { hour: number; feeds: number; diapers: number; sleeps: number }[];
}
