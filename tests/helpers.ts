import type { BaseConfig } from '@/lib/config';
import type { Dispatcher } from '@/lib/dispatch/types';
import type { Job } from '@/lib/queue';
import type { ServiceContext } from '@/lib/services/projects';
import { MemoryStore } from '@/lib/store/memory';

export const TEST_CONFIG: BaseConfig = {
  demo: false,
  databaseUrl: '',
  redisUrl: '',
  encryptionKey: 'ab'.repeat(32),
  allowedOwners: ['me'],
  appDomain: 'localhost',
  appScheme: 'http',
  appPublicPort: 8080,
};

/** Records jobs instead of running them. */
export class RecordingDispatcher implements Dispatcher {
  jobs: Job[] = [];
  failWith: Error | null = null;

  async enqueue(job: Job): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.jobs.push(job);
  }
}

export function testContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return { userId: 'owner', store: new MemoryStore(), config: TEST_CONFIG, dispatcher: new RecordingDispatcher(), ...overrides };
}

export const SAMPLE_PROJECT = { name: 'blog', repoUrl: 'https://github.com/me/blog', branch: 'main', port: 3000 };
