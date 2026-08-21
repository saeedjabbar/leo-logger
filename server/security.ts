import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashSecret(value: string) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString('base64url')}`;
}

export async function verifySecret(value: string, encoded?: string) {
  if (!encoded) return false;
  const [algorithm, salt, expectedText] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedText) return false;
  const expected = Buffer.from(expectedText, 'base64url');
  const actual = await scrypt(value, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
export function tokenId(token: string) { return createHash('sha256').update(token).digest('base64url'); }
