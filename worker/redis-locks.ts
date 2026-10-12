import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { ProjectLocks, Release } from '../lib/engine/types';

const RENEW = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';
const RELEASE = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * One runner per project across every worker process. The lock expires on its
 * own if the holder dies, and is renewed while the holder is alive, so a
 * ten-minute build keeps it without a ten-minute TTL.
 */
export class RedisLocks implements ProjectLocks {
  constructor(
    private readonly redis: IORedis,
    private readonly ttlMs = 60_000,
  ) {}

  async acquire(projectId: string): Promise<Release | null> {
    const key = `launchpad:lock:project:${projectId}`;
    const token = randomUUID();
    if ((await this.redis.set(key, token, 'PX', this.ttlMs, 'NX')) !== 'OK') return null;
    const renew = setInterval(() => {
      this.redis.eval(RENEW, 1, key, token, String(this.ttlMs)).catch((err) => console.error(`[locks] could not renew ${key}: ${err.message}`));
    }, this.ttlMs / 3);
    return async () => {
      clearInterval(renew);
      await this.redis.eval(RELEASE, 1, key, token).catch((err) => console.error(`[locks] could not release ${key}: ${err.message}`));
    };
  }
}
