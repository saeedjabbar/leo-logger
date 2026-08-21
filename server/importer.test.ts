import { describe, expect, it } from 'vitest';
import { importHuckleberry } from './importer.js';
import { MemoryStore } from './store.js';
import type { User } from './types.js';

const user: User = { id: 'admin', role: 'admin', displayName: 'Parent', allowedBabyIds: [], active: true, createdAt: new Date().toISOString() };

describe('Huckleberry importer', () => {
  it('preserves every source row and flags anomalies', async () => {
    const store = new MemoryStore(); await store.initialize();
    const csv = `"Type","Start","End","Duration","Start Condition","Start Location","End Condition","Notes"
"Feed","2026-08-20 10:00",,,"Formula","Bottle","2oz",""
"Feed","2026-08-20 10:00",,,"Formula","Bottle","2oz",""
"Feed","2026-08-20 08:00",,,"Breast Milk","Bottle","",""
"Pump","2026-08-20 07:00",,,"0oz","","",""`;
    const result = await importHuckleberry(store, csv, 'example.csv', 'leo', user);
    expect(result).toEqual({ rows: 4, imported: 4, skipped: 0, flagged: 3 });
    expect(await store.list('events')).toHaveLength(4);
    const retry = await importHuckleberry(store, csv, 'example.csv', 'leo', user);
    expect(retry.imported).toBe(0);
    expect(retry.skipped).toBe(4);
  });
});
