import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

const ITERATIONS = 210_000;
const KEYLEN = 32;
const DIGEST = 'sha256';

function derive(password: string, salt: Uint8Array, iterations: number) {
  return new Promise<any>((resolve, reject) => {
    pbkdf2(password, salt, iterations, KEYLEN, DIGEST, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, digest, iterationsRaw, saltRaw, expectedRaw] = encoded.split('$');
  if (scheme !== 'pbkdf2' || digest !== DIGEST || !iterationsRaw || !saltRaw || !expectedRaw) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = Buffer.from(saltRaw, 'base64');
    expected = Buffer.from(expectedRaw, 'base64');
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== KEYLEN) return false;

  const derived = await derive(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}
