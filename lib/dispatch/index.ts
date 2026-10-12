import { baseConfig } from '../config';
import { getStore } from '../store';
import type { Dispatcher } from './types';

export type { Dispatcher } from './types';

const globals = globalThis as unknown as { __launchpadDispatcher?: Promise<Dispatcher> };

export function getDispatcher(): Promise<Dispatcher> {
  return (globals.__launchpadDispatcher ??= (async () => {
    const config = baseConfig();
    if (!config.demo) {
      const { QueueDispatcher } = await import('./bullmq');
      return new QueueDispatcher(config.redisUrl);
    }
    const [{ InProcessDispatcher }, { SimulatedDriver }, { MemoryLocks }, { NoopRouter }] = await Promise.all([
      import('./demo'),
      import('../demo/simulated-driver'),
      import('../engine/locks'),
      import('../engine/types'),
    ]);
    const dispatcher = new InProcessDispatcher({
      store: await getStore(),
      driver: new SimulatedDriver(),
      router: new NoopRouter(),
      locks: new MemoryLocks(),
      encryptionKey: config.encryptionKey,
      settings: { healthTimeoutMs: 10_000, retainedReleases: 3, maxBuildLogLines: 5_000 },
    });
    await dispatcher.recover();
    return dispatcher;
  })());
}
