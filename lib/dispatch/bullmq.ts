import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { UnavailableError } from '../errors';
import { JOB_OPTIONS, JOB_QUEUE, jobKey, type Job } from '../queue';
import type { Dispatcher } from './types';

function withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(error), ms)))]).finally(() => clearTimeout(timer));
}

/** Publishes jobs to Redis. The worker, on its own host, is the only consumer. */
export class QueueDispatcher implements Dispatcher {
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', (err) => console.error(`[queue] redis: ${err.message}`));
    this.queue = new Queue(JOB_QUEUE, { connection });
  }

  async enqueue(job: Job): Promise<void> {
    await withTimeout(
      this.queue.add(job.type, job, { jobId: jobKey(job), ...JOB_OPTIONS }),
      5_000,
      new UnavailableError('The job queue is not reachable, so nothing was started. Check that Redis is running.'),
    );
  }
}
