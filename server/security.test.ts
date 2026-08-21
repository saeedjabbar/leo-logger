import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from './security.js';

describe('secret hashing', () => {
  it('uses salted hashes and constant-time verification', async () => {
    const first = await hashSecret('123456');
    const second = await hashSecret('123456');
    expect(first).not.toBe(second);
    expect(await verifySecret('123456', first)).toBe(true);
    expect(await verifySecret('654321', first)).toBe(false);
  });
});
