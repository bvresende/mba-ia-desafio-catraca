import crypto from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, storedHex] = parts;
  if (!salt || !storedHex) {
    return false;
  }

  let storedBuffer: Buffer;
  try {
    storedBuffer = Buffer.from(storedHex, 'hex');
  } catch {
    return false;
  }

  const derivedBuffer = crypto.scryptSync(plain, salt, KEY_LENGTH);
  if (derivedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedBuffer, storedBuffer);
}
