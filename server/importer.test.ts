import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { importHuckleberry } from './importer.js';
import { MemoryStore } from './store.js';
import type { User } from './types.js';

const user: User = { id: 'admin', role: 'master_admin', displayName: 'Admin', allowedBabyIds: [], active: true, createdAt: new Date().toISOString() };

describe('Huckleberry importer', () => {
  it('preserves every source row and flags anomalies', async () => {
    const store = new MemoryStore(); await store.initialize();
    const csv = await readFile('data.csv', 'utf8');
    const result = await importHuckleberry(store, csv, 'data.csv', 'leo', user);
    expect(result).toEqual({ rows: 248, imported: 248, skipped: 0, flagged: 5 });
    expect(await store.list('events')).toHaveLength(248);
    const retry = await importHuckleberry(store, csv, 'data.csv', 'leo', user);
    expect(retry.imported).toBe(0);
    expect(retry.skipped).toBe(248);
  });
});
