export type Role = 'admin' | 'caregiver';
export type EventType = 'feed' | 'diaper' | 'sleep' | 'legacy_pump';
export type FeedSource = 'formula' | 'breast_milk' | 'combo';
export type DiaperType = 'pee' | 'poop' | 'both';
export type EventChannel = 'pwa' | 'alexa' | 'import' | 'chat' | 'voice';

export interface Baby {
  id: string;
  name: string;
  birthDate?: string;
  timezone: string;
  feedingIntervalMinutes: number;
  active: boolean;
  createdAt: string;
}

export interface AiSettings {
  id: 'ai-settings';
  aiEnabled: boolean;
  providerMode: 'hosted';
  updatedAt: string;
  updatedBy?: string;
}

export interface ChatMessage {
  id: string;
  exchangeId: string;
  userId: string;
  babyId: string;
  role: 'user' | 'assistant';
  text: string;
  provider?: 'azure-openai' | 'built-in';
  eventIds?: string[];
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

export interface ReminderState {
  id: string;
  babyId: string;
  feedMarker?: string;
  uprightMarker?: string;
  notifiedAt: string;
}

export interface User {
  id: string;
  role: Role;
  displayName: string;
  email?: string;
  passwordHash?: string;
  pinHash?: string;
  allowedBabyIds: string[];
  defaultBabyId?: string;
  uprightTimerEnabled?: boolean;
  mustChangePassword?: boolean;
  active: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  userAgent?: string;
}

export interface Passkey {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  createdAt: string;
}

export interface Challenge {
  id: string;
  userId: string;
  challenge: string;
  kind: 'registration' | 'authentication';
  expiresAt: string;
}

export interface BabyEvent {
  id: string;
  babyId: string;
  type: EventType;
  startAt: string;
  endAt?: string;
  feed?: {
    ounces?: number;
    source: FeedSource;
    formulaOunces?: number;
    breastMilkOunces?: number;
  };
  diaper?: DiaperType;
  notes?: string;
  createdBy: string;
  channel: EventChannel;
  clientMutationId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  importWarnings?: string[];
  importSource?: string;
}

export interface EventRevision {
  id: string;
  eventId: string;
  actorId: string;
  action: 'update' | 'delete' | 'undo';
  snapshot: BabyEvent;
  createdAt: string;
}
