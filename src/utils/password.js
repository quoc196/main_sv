import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * scrypt from node:crypto rather than bcrypt/argon2: no native build step on
 * Render or CI, and it is memory-hard, which is what slows a GPU attacker down.
 *
 * The parameters travel inside the stored string, so raising N later only
 * affects new hashes; old ones keep verifying with the cost they were made at.
 */
const scrypt = promisify(scryptCb);

const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  const { N, r, p } = PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;

  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Verified against when the email does not exist, so "no such user" costs the
 * same scrypt run as "wrong password" and response time does not reveal which
 * emails are registered.
 */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
