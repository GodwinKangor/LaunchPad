import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for stored environment variable values.
 *
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url. The additional
 * authenticated data binds a ciphertext to its project and key, so a value
 * cannot be copied onto another row and still decrypt.
 */

const VERSION = 'v1';

function keyBytes(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return key;
}

export function envAad(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

export function encryptValue(plaintext: string, keyHex: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(keyHex), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptValue(payload: string, keyHex: string, aad: string): string {
  const [version, iv, tag, body] = payload.split('.');
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error('Unrecognised ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(keyHex), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
