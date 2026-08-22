import type { Store } from './store.js';
import type { AiSettings } from './types.js';

export type AiCapability = 'activity_interpretation' | 'insights' | 'speech_transcription';

const settingsId = 'ai-settings';

export async function getAiSettings(store: Store): Promise<AiSettings> {
  return await store.get<AiSettings>('meta', settingsId) || {
    id: settingsId,
    aiEnabled: true,
    providerMode: 'hosted',
    updatedAt: new Date(0).toISOString(),
  };
}

export async function setAiEnabled(store: Store, aiEnabled: boolean, actorId: string) {
  const settings: AiSettings = {
    id: settingsId,
    aiEnabled,
    providerMode: 'hosted',
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  };
  await store.put('meta', settings.id, settings);
  return settings;
}

// All hosted model access goes through this boundary. A future entitlement or
// provider policy can be added here without changing feature endpoints.
export async function resolveAiAccess(store: Store, capability: AiCapability) {
  const settings = await getAiSettings(store);
  return {
    capability,
    enabled: settings.aiEnabled,
    providerMode: settings.providerMode,
  } as const;
}
