import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { Store } from './store.js';
import type { BabyEvent, User } from './types.js';

interface HuckleberryRow {
  Type: string;
  Start: string;
  End: string;
  Duration: string;
  'Start Condition': string;
  'Start Location': string;
  'End Condition': string;
  Notes: string;
}

function parseOunces(value: string) {
  const number = Number.parseFloat(value.replace(/oz/i, ''));
  return Number.isFinite(number) ? number : undefined;
}

function sourceDate(value: string, timezoneOffset = '-04:00') {
  return new Date(value.replace(' ', 'T') + timezoneOffset).toISOString();
}

export async function importHuckleberry(store: Store, content: string, filename: string, babyId: string, actor: User) {
  const rows = parse(content, { columns: true, skip_empty_lines: true }) as HuckleberryRow[];
  const fingerprints = new Map<string, number>();
  const existing = await store.list<BabyEvent>('events');
  let imported = 0;
  let skipped = 0;
  let flagged = 0;

  for (const [index, row] of rows.entries()) {
    const source = `${filename}:${index + 2}`;
    if (existing.some((event) => event.importSource === source)) { skipped += 1; continue; }
    const fingerprint = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const seen = fingerprints.get(fingerprint) || 0;
    fingerprints.set(fingerprint, seen + 1);
    const warnings: string[] = [];
    if (seen) warnings.push('Possible exact duplicate');
    const now = new Date().toISOString();
    const base: BabyEvent = {
      id: randomUUID(), babyId, type: 'legacy_pump', startAt: sourceDate(row.Start), createdBy: actor.id,
      channel: 'import', notes: row.Notes || undefined, createdAt: now, updatedAt: now, importSource: source,
    };
    if (row.Type === 'Feed') {
      const ounces = parseOunces(row['End Condition']);
      if (ounces === undefined) warnings.push('Feed has no ounce amount');
      base.type = 'feed';
      base.feed = { ounces, source: row['Start Condition'] === 'Breast Milk' ? 'breast_milk' : 'formula' };
    } else if (row.Type === 'Diaper') {
      base.type = 'diaper';
      const condition = row['End Condition'];
      base.diaper = condition === 'Both' ? 'both' : condition.startsWith('Poo') ? 'poop' : 'pee';
    } else {
      warnings.push(`Legacy ${row.Type || 'unknown'} record`);
    }
    if (warnings.length) { base.importWarnings = warnings; flagged += 1; }
    await store.put('events', base.id, base);
    imported += 1;
  }
  return { rows: rows.length, imported, skipped, flagged };
}
