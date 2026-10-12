import { randomBytes } from 'node:crypto';

/** Lowercase hex ids: safe inside Docker tags, container names and BullMQ job ids. */
export function newId(): string {
  return randomBytes(12).toString('hex');
}

export function shortSuffix(): string {
  return randomBytes(3).toString('hex');
}
