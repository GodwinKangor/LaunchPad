import { DelayedError, Queue, Worker, type Job as QueueJob } from 'bullmq';
import IORedis from 'ioredis';
import { baseConfig, loadWorkerConfig } from '../lib/config';
import { runDeployment } from '../lib/engine/deploy';
import { NoopRouter, type EngineDeps } from '../lib/engine/types';
import { errorMessage } from '../lib/errors';
import { JOB_QUEUE, jobKey, type Job } from '../lib/queue';
import { createPrismaStore } from '../lib/store/prisma';
import { DockerDriver } from './docker';
import { abandon, recoverJobs } from './recover';
import { RedisLocks } from './redis-locks';

async function main() {
  const config = baseConfig();
  if (config.demo) {
    // Demo mode simulates deployments inside the dashboard. A real worker must never run alongside it.
    console.error('[worker] DEMO_MODE=true: the deployment worker does not run in demo mode.');
    process.exit(1);
  }
  const workerConfig = loadWorkerConfig();
  const { store, client } = createPrismaStore(config.databaseUrl);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', (err) => console.error(`[worker] redis: ${err.message}`));

  const deps: EngineDeps = {
    store,
    driver: new DockerDriver(workerConfig),
    router: new NoopRouter(),
    locks: new RedisLocks(redis),
    encryptionKey: config.encryptionKey,
    settings: {
      healthTimeoutMs: workerConfig.healthTimeoutMs,
      retainedReleases: workerConfig.retainedReleases,
      maxBuildLogLines: workerConfig.maxBuildLogLines,
    },
  };

  const queue = new Queue(JOB_QUEUE, { connection: redis });
  await recoverJobs(store, queue);

  const worker = new Worker<Job>(
    JOB_QUEUE,
    async (job: QueueJob<Job>, token?: string) => {
      console.log(`[worker] ${jobKey(job.data)} started (attempt ${job.attemptsMade + 1})`);
      const result = await runDeployment(deps, job.data.id);
      if (result === 'locked') {
        // Another job holds this project. Come back shortly without spending one of the job's attempts.
        await job.moveToDelayed(Date.now() + 3_000, token);
        throw new DelayedError();
      }
      console.log(`[worker] ${jobKey(job.data)} ${result}`);
    },
    { connection: redis.duplicate(), concurrency: workerConfig.concurrency, lockDuration: 60_000, maxStalledCount: 2 },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    console.error(`[worker] ${jobKey(job.data)} attempt ${job.attemptsMade} failed: ${errorMessage(err)}`);
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      abandon(store, job.data, 'it failed repeatedly; check the worker logs').catch((e) => console.error(`[worker] could not close out ${jobKey(job.data)}: ${errorMessage(e)}`));
    }
  });
  worker.on('error', (err) => console.error(`[worker] ${errorMessage(err)}`));

  console.log(`[worker] ready (concurrency ${workerConfig.concurrency}, network ${workerConfig.appNetwork})`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received; finishing active jobs`);
    // Jobs still running when the process is killed are redelivered by the queue and resumed safely.
    await worker.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
    await client.$disconnect().catch(() => undefined);
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`[worker] fatal: ${errorMessage(err)}`);
  process.exit(1);
});
