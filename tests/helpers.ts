import type { BaseConfig } from '@/lib/config';
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

export function testContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return { userId: 'owner', store: new MemoryStore(), config: TEST_CONFIG, ...overrides };
}

export const SAMPLE_PROJECT = { name: 'blog', repoUrl: 'https://github.com/me/blog', branch: 'main', port: 3000 };
