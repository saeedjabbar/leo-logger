import { describe, expect, it } from 'vitest';
import { getAiSettings, resolveAiAccess, setAiEnabled } from './ai.js';
import { MemoryStore } from './store.js';

describe('AI installation settings', () => {
  it('defaults hosted AI on for existing installations', async () => {
    const store = new MemoryStore();
    expect((await getAiSettings(store)).aiEnabled).toBe(true);
    expect((await resolveAiAccess(store, 'insights')).providerMode).toBe('hosted');
  });

  it('persists the admin-controlled switch for every capability', async () => {
    const store = new MemoryStore();
    await setAiEnabled(store, false, 'admin');
    expect((await resolveAiAccess(store, 'activity_interpretation')).enabled).toBe(false);
    expect((await resolveAiAccess(store, 'speech_transcription')).enabled).toBe(false);
    expect((await getAiSettings(store)).updatedBy).toBe('admin');
  });
});
