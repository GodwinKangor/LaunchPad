import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { baseConfig } from '../config';
import { MemoryStore, reviveSnapshot, type MemorySnapshot } from './memory';
import type { Store } from './types';

export type { Store } from './types';

const DEMO_FILE = path.join(process.cwd(), '.launchpad-demo.json');

// Survives Next.js hot reloads in development and is shared by every route in the process.
const globals = globalThis as unknown as { __launchpadStore?: Promise<Store> };

function createDemoStore(): Store {
  let snapshot: MemorySnapshot | undefined;
  if (existsSync(DEMO_FILE)) {
    try {
      snapshot = reviveSnapshot(readFileSync(DEMO_FILE, 'utf8'));
    } catch (err) {
      console.warn('[demo] ignoring unreadable demo data file:', err);
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const persist = (data: MemorySnapshot) => {
    // Debounced so a burst of log lines becomes one write.
    timer ??= setTimeout(() => {
      timer = undefined;
      try {
        writeFileSync(`${DEMO_FILE}.tmp`, JSON.stringify(data));
        renameSync(`${DEMO_FILE}.tmp`, DEMO_FILE);
      } catch (err) {
        console.warn('[demo] could not persist demo data:', err);
      }
    }, 250);
  };
  return new MemoryStore(snapshot, persist);
}

/** The dashboard's store: in-memory for demo mode, PostgreSQL otherwise. */
export function getStore(): Promise<Store> {
  return (globals.__launchpadStore ??= (async () => {
    const config = baseConfig();
    if (config.demo) return createDemoStore();
    // Imported lazily so demo mode never loads the database client.
    const { createPrismaStore } = await import('./prisma');
    return createPrismaStore(config.databaseUrl).store;
  })());
}
