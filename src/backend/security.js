import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const PASSWORD_KEY_LENGTH = 64;
const DUMMY_SALT = Buffer.alloc(16, 7);
const DUMMY_HASH = Buffer.alloc(PASSWORD_KEY_LENGTH, 3);

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH, SCRYPT_OPTIONS);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64url'),
    hash: Buffer.from(derived).toString('base64url'),
    ...SCRYPT_OPTIONS,
    keyLength: PASSWORD_KEY_LENGTH,
  };
}

export async function verifyPassword(password, stored) {
  const salt = stored?.salt ? Buffer.from(stored.salt, 'base64url') : DUMMY_SALT;
  const expected = stored?.hash ? Buffer.from(stored.hash, 'base64url') : DUMMY_HASH;
  const derived = Buffer.from(await scrypt(password, salt, PASSWORD_KEY_LENGTH, SCRYPT_OPTIONS));
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newId() {
  return randomUUID();
}

export function safeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
